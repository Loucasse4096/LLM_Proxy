import { HttpError } from 'wasp/server'
import crypto from 'crypto'

function getEnv(name: string, required = true): string | undefined {
  const v = process.env[name]
  if (required && (!v || v.length === 0)) throw new Error(`Missing env var ${name}`)
  return v
}

function encryptAesGcm(plaintext: string, keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: authTag.toString('base64') }
}

export const upsertProviderCred = async (
  args: { id?: string; provider: string; keyPlain: string; scope?: 'global' | 'user' },
  context: any
) => {
  if (!context.user) throw new HttpError(401)
  if (!args.provider || !args.keyPlain) throw new HttpError(400, 'Missing provider/key')
  const encKey = getEnv('LOG_ENCRYPTION_KEY') as string
  const enc = encryptAesGcm(args.keyPlain, encKey)
  const data = {
    provider: args.provider,
    keyCiphertext: enc.ciphertext,
    keyIv: enc.iv,
    keyAuthTag: enc.authTag,
    userId: args.scope === 'user' ? context.user.id : null
  }
  if (args.id) {
    const row = await context.entities.ProviderCredential.update({ where: { id: args.id }, data })
    return { id: row.id }
  } else {
    const row = await context.entities.ProviderCredential.create({ data })
    return { id: row.id }
  }
}

export const deleteProviderCred = async (
  args: { id: string },
  context: any
) => {
  if (!context.user) throw new HttpError(401)
  await context.entities.ProviderCredential.delete({ where: { id: args.id } })
  return {}
}



