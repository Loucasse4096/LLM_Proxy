import type { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

// Wasp injecte ces imports au build; on typpe faiblement pour l'éditeur.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const context: any

type DecisionType = 'ALLOW' | 'MASK' | 'BLOCK'
type RiskType = 'PII' | 'JAILBREAK' | 'TOXICITY' | 'OTHER'

function getEnv(name: string, required = true): string | undefined {
  const v = process.env[name]
  if (required && (!v || v.length === 0)) {
    throw new Error(`Missing env var ${name}`)
  }
  return v
}

function encryptAesGcm(plaintext: string, keyBase64: string) {
  const key = Buffer.from(keyBase64, 'base64')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64')
  }
}

const DEFAULT_BLACKLIST = [
  { term: 'password', riskType: 'PII' as RiskType },
  { term: 'ssn', riskType: 'PII' as RiskType },
  { term: 'prompt injection', riskType: 'JAILBREAK' as RiskType },
  { term: 'ignore previous instructions', riskType: 'JAILBREAK' as RiskType }
]

function detectRisks(prompt: string, dbTerms: { term: string; riskType: RiskType }[]): { riskTypes: RiskType[]; score: number } {
  const text = prompt.toLowerCase()
  const terms = [...DEFAULT_BLACKLIST, ...dbTerms]
  const hits = new Set<RiskType>()
  let score = 0
  for (const t of terms) {
    if (text.includes(t.term.toLowerCase())) {
      hits.add(t.riskType)
      score += 10
    }
  }
  // Regex PII simples
  const piiRegexes = [
    /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, // SSN US
    /\b\d{16}\b/g, // carte simple
    /\b[\w.-]+@[\w.-]+\.[A-Za-z]{2,}\b/g // email
  ]
  for (const r of piiRegexes) {
    if (r.test(prompt)) {
      hits.add('PII')
      score += 15
    }
  }
  return { riskTypes: Array.from(hits), score }
}

async function getBlacklist(db: PrismaClient): Promise<{ term: string; riskType: RiskType }[]> {
  try {
    const rows = await (db as any).blacklistTerm.findMany({ select: { term: true, riskType: true } })
    return rows.map((r:any)=> ({ term: r.term, riskType: r.riskType as RiskType }))
  } catch {
    return []
  }
}

export { encryptAesGcm, detectRisks, getBlacklist, getEnv }


