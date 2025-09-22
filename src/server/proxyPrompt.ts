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
  let responseEnc: { ciphertext: string; iv: string; authTag: string } | undefined
  let pt: number | undefined, ct: number | undefined, tt: number | undefined

  if (decision !== 'BLOCK') {
    const maskedPrompt = decision === 'MASK' ? '[MASKED] ' + args.prompt.slice(0, 100) : args.prompt
    console.log(`[proxyAction] userId=${context.user.id} fetching ProviderCredential…`)
    const cred = await context.entities.ProviderCredential.findFirst({
      where: { provider: 'openai', userId: context.user.id },
    })
    if (!cred) throw new HttpError(400, 'No OpenAI key configured for user')
    const keyBuf = Buffer.from(cred.keyCiphertext, 'base64') // on ne déchiffre pas, on utilise en clair mémoire? Non: il faut déchiffrer
    // Déchiffrement (utilise la même LOG_ENCRYPTION_KEY)
    const key = (()=>{
      const iv = Buffer.from(cred.keyIv, 'base64')
      const authTag = Buffer.from(cred.keyAuthTag, 'base64')
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'base64'), iv)
      decipher.setAuthTag(authTag)
      const plain = Buffer.concat([decipher.update(keyBuf), decipher.final()]).toString('utf8')
      return plain
    })()
    const openaiKey = key
    const chosenModel = args.model || 'gpt-4o-mini'
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

  return { decision, response: decision === 'BLOCK' ? null : responseText ?? null, logId: log.id }
}


