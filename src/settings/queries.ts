import type { GetProviderCreds } from 'wasp/server/operations'
import { HttpError } from 'wasp/server'

export const getProviderCreds: GetProviderCreds<{}, any[]> = async (_args, context) => {
  if (!context.user) throw new HttpError(401)
  const rows = await context.entities.ProviderCredential.findMany({
    where: { OR: [ { userId: context.user.id }, { userId: null } ] },
    select: { id: true, provider: true, createdAt: true, updatedAt: true, userId: true }
  })
  return rows
}



