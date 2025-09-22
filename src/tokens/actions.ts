import { HttpError } from 'wasp/server'
import crypto from 'crypto'

export const createApiToken = async (
  args: { name: string },
  context: any
) => {
  if (!context.user) throw new HttpError(401)
  if (!args.name) throw new HttpError(400, 'Missing token name')
  const raw = crypto.randomBytes(24).toString('base64url')
  const token = `pat_${raw}`
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  await context.entities.ApiToken.create({ data: { name: args.name, tokenHash, userId: context.user.id } })
  // On retourne le token en clair une seule fois
  return { token }
}

export const revokeApiToken = async (
  args: { id: string },
  context: any
) => {
  if (!context.user) throw new HttpError(401)
  await context.entities.ApiToken.update({ where: { id: args.id }, data: { revokedAt: new Date() } })
  return {}
}



