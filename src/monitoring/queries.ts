import type { GetLogs, GetStats } from 'wasp/server/operations'
import { HttpError } from 'wasp/server'
type DecisionType = 'ALLOW' | 'MASK' | 'BLOCK'
type RiskType = 'PII' | 'JAILBREAK' | 'TOXICITY' | 'OTHER'

export const getLogs: GetLogs<{ from?: string; to?: string; decision?: DecisionType; risk?: RiskType }, any[]> = async (args, context) => {
  if (!context.user) throw new HttpError(401)
  const where: any = {}
  if (args?.from || args?.to) {
    where.createdAt = {}
    if (args.from) where.createdAt.gte = new Date(args.from)
    if (args.to) where.createdAt.lte = new Date(args.to)
  }
  if (args?.decision) where.decision = args.decision
  if (args?.risk) {
    where.AND = [
      {
        // Prisma ne filtre pas JSON array facilement; côté MVP on ramène tout et on filtre en mémoire
      }
    ]
  }

  const logs = await context.entities.LogEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      createdAt: true,
      decision: true,
      riskTypes: true,
      riskScore: true,
      clientId: true,
      model: true,
      totalTokens: true
    }
  })
  const parsed = logs.map((l:any)=> ({ ...l, riskTypes: l.riskTypes ? JSON.parse(l.riskTypes) : [] }))
  if (args?.risk) {
    return parsed.filter((l:any) => (l.riskTypes||[]).includes(args.risk))
  }
  return parsed
}

export const getStats: GetStats<{}, any> = async (_args, context) => {
  if (!context.user) throw new HttpError(401)
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24)
  const [countAll, byDecision, byRisk] = await Promise.all([
    context.entities.LogEntry.count({}),
    context.entities.LogEntry.groupBy({ by: ['decision'], _count: { _all: true } as any }),
    context.entities.LogEntry.findMany({ select: { riskTypes: true } })
  ])
  const riskCounts: Record<string, number> = {}
  for (const r of byRisk) {
    const arr = (r.riskTypes ? JSON.parse(r.riskTypes as unknown as string) : []) as string[]
    for (const t of arr) riskCounts[t] = (riskCounts[t] ?? 0) + 1
  }
  return {
    countAll,
    byDecision,
    riskCounts,
    since
  }
}

export const addBlacklistTerm = async (args: { term: string; riskType: RiskType }, context: any) => {
  if (!context.user) throw new HttpError(401)
  if (!args.term || !args.riskType) throw new HttpError(400, 'Missing')
  const row = await context.entities.BlacklistTerm.create({ data: { term: args.term, riskType: args.riskType } })
  return { id: row.id }
}

export const removeBlacklistTerm = async (args: { id: string }, context: any) => {
  if (!context.user) throw new HttpError(401)
  await context.entities.BlacklistTerm.delete({ where: { id: args.id } })
  return {}
}

export const markFalsePositive = async (args: { id: string }, context: any) => {
  if (!context.user) throw new HttpError(401)
  await context.entities.LogEntry.update({ where: { id: args.id }, data: { isFalsePositive: true } })
  return {}
}


