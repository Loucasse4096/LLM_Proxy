import { useState, useMemo, useRef, useEffect } from 'react'
import { proxyPrompt } from 'wasp/client/operations'
import { Button } from '../shared/components/Button'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chatId = useMemo(() => crypto.randomUUID(), [])
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function sendMessage() {
    const text = input.trim()
    if (!text || loading) return
    setError(null)
    setLoading(true)
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    try {
      const res = await proxyPrompt({ prompt: text, metadata: { chatId } })
      if (res.decision === 'BLOCK') {
        const analysis = res.analysis || "Votre requête a été bloquée. Reformulez sans données sensibles ni jailbreak."
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'system', content: analysis }])
      } else {
        const content = res.response || ''
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }])
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full p-6">
      <h1 className="text-2xl font-semibold mb-4">Chat</h1>
      <div className="border rounded-md bg-white h-[60vh] overflow-y-auto p-4 flex flex-col gap-3">
        {messages.map((m) => (
          <div key={m.id} className={
            m.role === 'user' ? 'self-end bg-blue-600 text-white rounded-lg px-3 py-2 max-w-[80%] whitespace-pre-wrap' :
            m.role === 'assistant' ? 'self-start bg-neutral-100 rounded-lg px-3 py-2 max-w-[80%] whitespace-pre-wrap' :
            'self-center text-sm text-neutral-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-[80%] whitespace-pre-wrap'
          }>
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-4 flex items-end gap-3">
        <textarea
          className="flex-1 border rounded-md p-2 min-h-[60px]" placeholder="Écrivez votre message…"
          value={input}
          onChange={(e)=> setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        <Button onClick={sendMessage} disabled={loading || input.trim().length === 0}>
          {loading ? 'Envoi…' : 'Envoyer'}
        </Button>
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600">{error}</div>
      )}
    </div>
  )
}



