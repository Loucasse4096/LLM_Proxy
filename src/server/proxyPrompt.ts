import { HttpError } from 'wasp/server'
import crypto from 'crypto'
import { encryptAesGcm, detectRisks, getBlacklist, getEnv } from './setup'

export const proxyPrompt = async (
  args: { prompt: string; model?: string; metadata?: any },
  context: any
) => {
  if (!context.user) throw new HttpError(401)
  if (!args?.prompt || typeof args.prompt !== 'string') throw new HttpError(400, 'Invalid prompt')

  const blacklist = await getBlacklist(context.entities as any)
  const { riskTypes, score } = detectRisks(args.prompt, blacklist)

  let decision: 'ALLOW' | 'MASK' | 'BLOCK' = 'ALLOW'
  if (score >= 25 || riskTypes.includes('JAILBREAK' as any)) decision = 'BLOCK'
  else if (score >= 10 || riskTypes.includes('PII' as any)) decision = 'MASK'

  const encKey = getEnv('LOG_ENCRYPTION_KEY') as string
  const encPrompt = encryptAesGcm(args.prompt, encKey)

  let responseText: string | undefined
  let analysisText: string | undefined
  let responseEnc: { ciphertext: string; iv: string; authTag: string } | undefined
  let pt: number | undefined, ct: number | undefined, tt: number | undefined

  // Récupération éventuelle de la clé provider (utile aussi pour l'analyse côté BLOCK)
  let openaiKey: string | undefined
  let chosenModel = args.model || 'gpt-4o-mini'
  try {
    const cred = await context.entities.ProviderCredential.findFirst({
      where: { provider: 'openai', userId: context.user.id },
    })
    if (cred) {
      const iv = Buffer.from(cred.keyIv, 'base64')
      const authTag = Buffer.from(cred.keyAuthTag, 'base64')
      const ciphertext = Buffer.from(cred.keyCiphertext, 'base64')
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'base64'), iv)
      decipher.setAuthTag(authTag)
      openaiKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    }
  } catch (e: any) {
    console.warn(`[proxyAction] Provider key decrypt failed: ${e?.message}`)
  }

  if (decision !== 'BLOCK') {
    const maskedPrompt = decision === 'MASK' ? '[MASKED] ' + args.prompt.slice(0, 100) : args.prompt
    if (!openaiKey) throw new HttpError(400, 'No OpenAI key configured for user')
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: chosenModel, messages: [{ role: 'user', content: maskedPrompt }] })
    })
    if (!r.ok) throw new Error(`LLM error: ${r.status}`)
    const data = await r.json()
    responseText = (data.choices?.[0]?.message?.content ?? '') + ''
    pt = data.usage?.prompt_tokens
    ct = data.usage?.completion_tokens
    tt = data.usage?.total_tokens
    responseEnc = encryptAesGcm(responseText || '', encKey)
  } else {
    // Génère une explication sans divulguer le prompt d'origine.
    const safeAnalysisPrompt = `Explique de manière concise et empathique en français pourquoi une requête utilisateur a été bloquée selon ces risques: ${JSON.stringify(riskTypes)} et un score ${score}. Donne des conseils pour reformuler sans données sensibles ni jailbreak. N'inclus aucune partie de la requête.`
    if (openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: chosenModel, messages: [
            { role: 'system', content: 'Tu es un assistant de conformité qui explique les politiques de sécurité.' },
            { role: 'user', content: safeAnalysisPrompt }
          ] })
        })
        if (r.ok) {
          const data = await r.json()
          analysisText = (data.choices?.[0]?.message?.content ?? '') + ''
        }
      } catch (e: any) {
        console.warn(`[proxyAction] Analysis generation failed: ${e?.message}`)
      }
    }
    if (!analysisText) {
      analysisText = `Votre requête a été bloquée pour des raisons de sécurité (${riskTypes.join(', ') || 'risques'}). Évitez d'inclure des données sensibles ou des tentatives de jailbreak, et reformulez votre question de manière générale.`
    }
    responseEnc = encryptAesGcm(analysisText, encKey)
  }

  const log = await context.entities.LogEntry.create({
    data: {
      triggeredByUserId: context.user.id,
      endUserId: args.metadata?.endUserId,
      clientId: null,
      metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
      decision,
      riskTypes: JSON.stringify(riskTypes),
      riskScore: score,
      promptCiphertext: encPrompt.ciphertext,
      promptIv: encPrompt.iv,
      promptAuthTag: encPrompt.authTag,
      responseCiphertext: responseEnc?.ciphertext,
      responseIv: responseEnc?.iv,
      responseAuthTag: responseEnc?.authTag,
      model: args.model,
      promptTokens: pt,
      completionTokens: ct,
      totalTokens: tt
    }
  })

  return { decision, riskTypes, riskScore: score, response: decision === 'BLOCK' ? null : responseText ?? null, analysis: decision === 'BLOCK' ? analysisText ?? null : null, logId: log.id }
}


