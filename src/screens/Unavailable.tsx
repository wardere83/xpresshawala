import { useNavigate } from 'react-router-dom'
import { PrimaryButton, ScreenHeader } from '../components/ui'

export function Unavailable({ title, message, to = '/app', action = 'Back to account' }: {
  title: string; message: string; to?: string; action?: string
}) {
  const navigate = useNavigate()
  return <div className="flex flex-1 flex-col overflow-hidden">
    <ScreenHeader title={title} onBack={() => navigate(-1)} />
    <div className="px-4 py-6">
      <p className="mb-5 text-[14px] leading-relaxed text-ink-700">{message}</p>
      <PrimaryButton onClick={() => navigate(to)}>{action}</PrimaryButton>
    </div>
  </div>
}
