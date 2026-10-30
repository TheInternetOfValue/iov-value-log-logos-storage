export function PageIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return <header><h1>{title}</h1><p className="lede">{children}</p></header>;
}
