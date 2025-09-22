import crypto from 'crypto'
import { encryptAesGcm, detectRisks, getBlacklist, getEnv } from './setup'

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id))
}

export async function proxyHttp(req: any, res: any, context: any) {
  console.log(`[proxy] proxyHttp called`)
  try {
    const { prompt, model, metadata } = req.body ?? {}
    if (typeof prompt !== 'string' || prompt.length === 0) {
      return res.status(400).json({ error: 'Invalid prompt' })
    }

    // Auth: Authorization: Bearer <token>
    let userId: string | null = null
    const auth = req.headers['authorization']
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      const token = auth.slice(7).trim()
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      console.log(`[proxy] Bearer token received, hashPrefix=${tokenHash.slice(0, 8)}…`)
      const t = await context.entities.ApiToken.findFirst({ where: { tokenHash } })
      if (!t) {
        console.warn(`[proxy] Token not found or revoked. hashPrefix=${tokenHash.slice(0, 8)}…`)
        return res.status(401).json({ error: 'Invalid credentials', data: {} })
      }
      if (t.revokedAt) {
        console.warn(`[proxy] Token revoked. hashPrefix=${tokenHash.slice(0, 8)}…`)
        return res.status(401).json({ error: 'Invalid credentials', data: {} })
      }
      userId = t.userId
      console.log(`[proxy] Token OK, userId=${userId}`)
    } else if (context.user) {
      userId = context.user.id
      console.log(`[proxy] Auth via session, userId=${userId}`)
    } else {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const blacklist = await getBlacklist(context.entities as any)
    const { riskTypes, score } = detectRisks(prompt, blacklist)

    let decision: 'ALLOW' | 'MASK' | 'BLOCK' = 'ALLOW'
    if (score >= 25 || riskTypes.includes('JAILBREAK' as any)) decision = 'BLOCK'
    else if (score >= 10 || riskTypes.includes('PII' as any)) decision = 'MASK'

    const encKey = getEnv('LOG_ENCRYPTION_KEY') as string
    const encPrompt = encryptAesGcm(prompt, encKey)

    let responseText: string | undefined
    let responseEnc: { ciphertext: string; iv: string; authTag: string } | undefined
    let pt: number | undefined, ct: number | undefined, tt: number | undefined

    if (decision !== 'BLOCK') {
      // Récup clé OpenAI chiffrée (obligatoirement liée à l'utilisateur)
      const cred = await context.entities.ProviderCredential.findFirst({
        where: { provider: 'openai', userId },
      })
      if (!cred) {
        console.warn(`[proxy] No ProviderCredential for userId=${userId}`)
        return res.status(400).json({ error: 'No OpenAI key configured for user' })
      }

      const iv = Buffer.from(cred.keyIv, 'base64')
      const authTag = Buffer.from(cred.keyAuthTag, 'base64')
      const ciphertext = Buffer.from(cred.keyCiphertext, 'base64')
      let openaiKey = ''
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encKey, 'base64'), iv)
        decipher.setAuthTag(authTag)
        openaiKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
      } catch (e: any) {
        console.error(`[proxy] OpenAI key decrypt failed for userId=${userId}: ${e?.message}`)
        return res.status(500).json({ error: 'Provider key decryption failed' })
      }

      const maskedPrompt = decision === 'MASK' ? '[MASKED] ' + prompt.slice(0, 100) : prompt
      const chosenModel = model || 'gpt-4o-mini'
      const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: chosenModel, messages: [{ role: 'user', content: maskedPrompt }] })
      }, 20000)
      if (!r.ok) {
        const txt = await r.text().catch(()=> '')
        console.warn(`[proxy] Upstream OpenAI error status=${r.status} bodyLen=${txt?.length ?? 0}`)
        return res.status(502).json({ error: 'LLM upstream error', status: r.status, body: txt })
      }
      const data = await r.json()
      responseText = (data.choices?.[0]?.message?.content ?? '') + ''
      pt = data.usage?.prompt_tokens
      ct = data.usage?.completion_tokens
      tt = data.usage?.total_tokens
      responseEnc = encryptAesGcm(responseText || '', encKey)
    }

    const log = await context.entities.LogEntry.create({
      data: {
        triggeredByUserId: userId ?? undefined,
        endUserId: metadata?.endUserId,
        clientId: null,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        decision,
        riskTypes: JSON.stringify(riskTypes),
        riskScore: score,
        promptCiphertext: encPrompt.ciphertext,
        promptIv: encPrompt.iv,
        promptAuthTag: encPrompt.authTag,
        responseCiphertext: responseEnc?.ciphertext,
        responseIv: responseEnc?.iv,
        responseAuthTag: responseEnc?.authTag,
        model,
        promptTokens: pt,
        completionTokens: ct,
        totalTokens: tt
      }
    })

    console.log(`[proxy] Done decision=${decision} userId=${userId} logId=${log.id}`)
    return res.json({ decision, riskTypes, riskScore: score, response: decision === 'BLOCK' ? null : responseText ?? null, logId: log.id })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'Internal error')
    console.error(`[proxy] Unhandled error: ${msg}`)
    return res.status(500).json({ error: msg })
  }
}



