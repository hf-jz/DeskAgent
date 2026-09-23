// ── Component registry: maps kind → React component ──
import Dashboard from './Dashboard'
import Feed from './Feed'
import Monitor from './Monitor'
import Checklist from './Checklist'
import Counter from './Counter'
import Clock from './Clock'
import Chart from './Chart'
import Alerts from './Alerts'
import TextBlock from './TextBlock'
import Links from './Links'
import ImageBlock from './ImageBlock'
import Iframe from './Iframe'
import ContentStudio from './ContentStudio'

export const COMPONENTS: Record<string, React.FC<any>> = {
  dashboard: Dashboard,
  feed: Feed,
  monitor: Monitor,
  checklist: Checklist,
  counter: Counter,
  clock: Clock,
  chart: Chart,
  alerts: Alerts,
  text: TextBlock,
  links: Links,
  image: ImageBlock,
  iframe: Iframe,
  // 办公创作: 设计界面 (素材文件夹 + 风格预设 → 生成成品)
  presentation: ContentStudio,
  brochure: ContentStudio,
  manual: ContentStudio,
  video: ContentStudio,
  homepage: ContentStudio,
}
