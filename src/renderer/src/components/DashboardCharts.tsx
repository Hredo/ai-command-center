/**
 * Las dos gráficas del panel: gasto y tokens por día.
 *
 * Viven en su propio fichero por dos motivos que van juntos. Uno, la librería
 * de gráficas pesa más que el resto de la aplicación entera, y aquí se carga
 * sola cuando hay datos que dibujar en vez de al arrancar. Y dos, al sacarlas
 * pueden coger los colores del tema, que es lo que antes no pasaba: estaban
 * escritos a mano y un tema claro dejaba las líneas invisibles.
 */
import React from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar
} from 'recharts'
import { Coins, DollarSign } from 'lucide-react'
import { Panel, PanelHeader } from './ui'
import { usePrefs } from '../lib/prefs'
import { cost, tokens } from '../lib/format'

import { useT } from '../lib/i18n'
export interface DayPoint {
  label: string
  cost: number
  tokensIn: number
  tokensOut: number
}

function ChartTip({ active, payload, label }: any): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-raised border border-line rounded-lg px-2.5 py-2 shadow-xl text-[11.5px]">
      <div className="text-dim mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 num">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color ?? p.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="text-ink ml-auto">{p.dataKey === 'cost' ? cost(p.value) : tokens(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function DashboardCharts({ data }: { data: DayPoint[] }): React.JSX.Element {
  const t = useT()
  const { theme } = usePrefs()
  const ui = theme.ui

  const axis = {
    stroke: ui.dim,
    fontSize: 10.5,
    fontFamily: 'var(--font-mono)'
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      <Panel className="col-span-2 flex flex-col">
        <PanelHeader
          title={t('dash.costByDay')}
          subtitle={t('dash.costByDay.hint')}
          icon={<DollarSign size={14} />}
        />
        <div className="p-3 h-[212px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ui.accent} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={ui.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={ui.line} vertical={false} />
              <XAxis dataKey="label" {...axis} tickLine={false} axisLine={false} minTickGap={22} />
              <YAxis
                {...axis}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v) => (v === 0 ? '0' : cost(v))}
              />
              <Tooltip content={<ChartTip />} cursor={{ stroke: ui.line }} />
              <Area
                type="monotone"
                dataKey="cost"
                name={t('dash.cost')}
                stroke={ui.accent}
                strokeWidth={1.6}
                fill="url(#gCost)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel className="flex flex-col">
        <PanelHeader title={t('dash.tokensByDay')} subtitle={t('dash.tokensByDay.hint')} icon={<Coins size={14} />} />
        <div className="p-3 h-[212px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={ui.line} vertical={false} />
              <XAxis dataKey="label" {...axis} tickLine={false} axisLine={false} minTickGap={26} />
              <YAxis {...axis} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => tokens(v)} />
              <Tooltip content={<ChartTip />} cursor={{ fill: ui.raised }} />
              <Bar dataKey="tokensIn" name={t('dash.in')} stackId="t" fill={ui.accentDim} />
              <Bar dataKey="tokensOut" name={t('dash.out')} stackId="t" fill={ui.accent} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  )
}
