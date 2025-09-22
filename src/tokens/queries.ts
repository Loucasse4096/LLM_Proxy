import type { ListApiTokens } from 'wasp/server/operations'
import { HttpError } from 'wasp/server'

export const listApiTokens: ListApiTokens<{}, any[]> = async (_args, context) => {
  if (!context.user) throw new HttpError(401)
  const rows = await context.entities.ApiToken.findMany({
    where: { userId: context.user.id },
    select: { id: true, name: true, createdAt: true, revokedAt: true }
  })
  return rows
}



