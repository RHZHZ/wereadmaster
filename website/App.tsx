import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Cloud,
  Download,
  FileOutput,
  Github,
  LockKeyhole,
  Menu,
  NotebookPen,
  ShieldCheck,
  Sparkles,
  Workflow,
  X
} from "lucide-react";
import shelfView from "../src/assets/shelf.png";
import notesView from "../src/assets/notes.png";
import settingsView from "../src/assets/generated/set.png";
import heroDeskScene from "../output/imagegen/website-hero-composite.png";
import downloadDeskScene from "../output/imagegen/website-download-desk.png";

const repositoryUrl = "https://github.com/RHZHZ/wereadmaster";
const releaseUrl = "https://github.com/RHZHZ/wereadmaster/releases";
const updateDocUrl = "../docs/github-release-updates.md";

const navItems = [
  { id: "top", label: "首页" },
  { id: "features", label: "功能" },
  { id: "screenshots", label: "截图" },
  { id: "open-source", label: "开源" },
  { id: "download", label: "下载" }
] as const;

const valuePillars = [
  {
    icon: <LockKeyhole aria-hidden="true" size={22} />,
    title: "本地优先，隐私安心",
    description: "书架缓存、阅读状态和 AI 输出尽量留在本机，不上传、不混乱、不失控。"
  },
  {
    icon: <Workflow aria-hidden="true" size={22} />,
    title: "结构化复盘，形成体系",
    description: "把书籍、笔记与想法收拢成可复盘、可追踪、可继续使用的知识资产。"
  },
  {
    icon: <FileOutput aria-hidden="true" size={22} />,
    title: "阅读到输出，高效闭环",
    description: "从同步到复盘再到 Markdown 导出，让阅读更容易进入写作与知识沉淀流程。"
  }
] as const;

const workflowSteps = [
  {
    icon: <Cloud aria-hidden="true" size={20} />,
    title: "同步",
    description: "把微信读书里的书架、笔记、统计写入本地缓存。"
  },
  {
    icon: <NotebookPen aria-hidden="true" size={20} />,
    title: "笔记与整理",
    description: "围绕划线、想法和候选书，完成筛选、标记与阅读规划。"
  },
  {
    icon: <Sparkles aria-hidden="true" size={20} />,
    title: "AI 复盘",
    description: "在你手动触发时生成阅读指南、书籍复盘和下一步建议。"
  },
  {
    icon: <FileOutput aria-hidden="true" size={20} />,
    title: "Markdown 导出",
    description: "把阅读成果导出到你自己的写作、归档和知识管理系统里。"
  }
] as const;

const showcaseSlides = [
  {
    id: "shelf",
    badge: "书架",
    title: "把书架、筛选、分类与阅读状态收进同一个桌面入口",
    description: "总览藏书结构、分类筛选与候选书入口，保持继续阅读的上下文。",
    image: shelfView
  },
  {
    id: "notes",
    badge: "笔记详情",
    title: "把划线、想法与导出动作收进同一条阅读路径",
    description: "把划线、想法与导出动作收进同一条阅读路径。",
    image: notesView
  },
  {
    id: "settings",
    badge: "本地设置",
    title: "把同步、AI、导出与安全边界集中管理",
    description: "把同步、AI、导出与安全边界集中管理。",
    image: settingsView
  }
] as const;

const trustPoints = [
  {
    icon: <LockKeyhole aria-hidden="true" size={20} />,
    title: "本地优先",
    description: "所有关键数据尽量只保存在本机，避免平台绑定式的长期失控。"
  },
  {
    icon: <ShieldCheck aria-hidden="true" size={20} />,
    title: "隐私安全",
    description: "不收集额外个人信息，不把你的阅读内容写进第三方服务。"
  },
  {
    icon: <Sparkles aria-hidden="true" size={20} />,
    title: "持续迭代",
    description: "围绕重度读者的真实工作流，把阅读、复盘和输出做得更顺。"
  }
] as const;

export function OfficialSiteApp() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeShowcaseIndex, setActiveShowcaseIndex] = useState(0);
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const activeShowcase = showcaseSlides[activeShowcaseIndex];

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <a className="site-brand" href="#top" aria-label="微信读书个人阅读管理官网首页">
            <span className="site-brand-mark">
              <BookOpen aria-hidden="true" size={18} />
            </span>
            <span className="site-brand-copy">
              <strong>微信读书个人阅读管理</strong>
              <small>本地优先的阅读资产工作台</small>
            </span>
          </a>

          <button
            className="site-menu-toggle"
            type="button"
            aria-expanded={isMenuOpen}
            aria-label={isMenuOpen ? "关闭导航" : "打开导航"}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            {isMenuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>

          <nav className={`site-nav ${isMenuOpen ? "is-open" : ""}`} aria-label="官网导航">
            <div className="site-nav-links">
              {navItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={item.id === "top" ? "is-active" : undefined}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </div>
            <div className="site-nav-actions">
              <a className="site-nav-github" href={repositoryUrl} target="_blank" rel="noreferrer">
                <Github aria-hidden="true" size={18} />
                GitHub
              </a>
              <a className="site-nav-download" href={releaseUrl} target="_blank" rel="noreferrer">
                <Download aria-hidden="true" size={18} />
                下载 Windows 版
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero-section" id="top">
          <div className="hero-background" aria-hidden="true">
            <img src={heroDeskScene} alt="" />
          </div>
          <div className="hero-inner">
            <div className="hero-copy">
              <h1>把微信读书记录变成本地的阅读资产</h1>
              <p>
                书架、笔记、统计、AI 复盘，一站式管理。本地优先，数据只在你手边，帮助你把阅读沉淀成长期可复用的个人知识库。
              </p>
              <div className="hero-actions">
                <a className="primary-button primary-button--stacked" href={releaseUrl} target="_blank" rel="noreferrer">
                  <Download aria-hidden="true" size={18} />
                  <span>
                    <strong>下载 Windows 版</strong>
                    <small>GitHub Releases</small>
                  </span>
                </a>
                <a className="secondary-button secondary-button--stacked" href={repositoryUrl} target="_blank" rel="noreferrer">
                  <span>
                    <strong>查看项目地址</strong>
                    <small>GitHub</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} />
                </a>
              </div>
              <ul className="hero-proof-list" aria-label="产品要点">
                <li>本地存储优先</li>
                <li>数据边界可控</li>
                <li>支持 Markdown 导出</li>
                <li>GitHub Releases 分发</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="value-section" id="features">
          <div className="section-intro">
            <h2>专为重度阅读者打造的本地阅读工作台</h2>
            <p>不只是管理，更是把阅读变成可复盘、可沉淀、可输出的知识资产。</p>
          </div>
          <div className="value-grid">
            {valuePillars.map((item) => (
              <article key={item.title} className="value-item">
                <span className="value-icon">{item.icon}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="workflow-section">
          <div className="section-intro">
            <h2>从微信读书到你的知识库，只需四步</h2>
            <p>一次设置，长期受益。</p>
          </div>
          <ol className="workflow-list">
            {workflowSteps.map((step, index) => (
              <li key={step.title} className="workflow-item">
                <span className="workflow-icon">{step.icon}</span>
                <div className="workflow-meta">
                  <span className="workflow-index">{index + 1}</span>
                  <h3>{step.title}</h3>
                </div>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="screenshots-section" id="screenshots">
          <div className="section-intro section-intro--left">
            <h2>产品截图</h2>
            <p>直观、实用，围绕真实阅读流程设计，而不是只堆页面。</p>
          </div>

          <div className="screenshots-layout">
            <article className="screenshots-gallery">
              <div className="screenshots-carousel-viewport">
                <div
                  className="screenshots-carousel-track"
                  style={{ transform: `translateX(-${activeShowcaseIndex * 100}%)` }}
                >
                  {showcaseSlides.map((slide) => (
                    <div key={slide.id} className="screenshots-carousel-slide">
                      <div className="screenshots-gallery-frame">
                        <img src={slide.image} alt={slide.title} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="screenshots-gallery-meta">
                <div className="screenshots-gallery-copy">
                  <span className="screenshots-badge">{activeShowcase.badge}</span>
                  <h3>{activeShowcase.title}</h3>
                  <p>{activeShowcase.description}</p>
                </div>
                <div className="screenshots-carousel-dots" aria-label="产品截图切换">
                  {showcaseSlides.map((slide, index) => (
                    <button
                      key={slide.id}
                      type="button"
                      className={`screenshots-carousel-dot ${index === activeShowcaseIndex ? "is-active" : ""}`}
                      aria-label={`查看${slide.badge}`}
                      aria-pressed={index === activeShowcaseIndex}
                      onClick={() => setActiveShowcaseIndex(index)}
                    />
                  ))}
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="trust-section" id="open-source">
          <div className="trust-lead">
            <div className="section-intro section-intro--left">
              <h2>开源透明，值得信赖</h2>
              <p>代码公开可查，数据尽量只留在本地，帮助你把阅读掌控权拿回来。</p>
            </div>
            <article className="repo-card">
              <div className="repo-card-topline">
                <div className="repo-card-title-group">
                  <span className="repo-card-repo-icon">
                    <Github aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <div className="repo-card-title-row">
                      <h3>RHZHZ/wereadmaster</h3>
                      <span className="repo-card-visibility">Public</span>
                    </div>
                    <p className="repo-card-summary">微信读书个人阅读管理 · 本地优先的阅读工作台</p>
                  </div>
                </div>
                <a className="repo-card-link" href={repositoryUrl} target="_blank" rel="noreferrer">
                  访问 GitHub
                  <ArrowRight aria-hidden="true" size={16} />
                </a>
              </div>

              <div className="repo-card-tags" aria-label="项目标签">
                <span>GitHub Releases</span>
                <span>React + Vite + Tauri</span>
                <span>本地缓存 + 手动 AI 调用</span>
                <span>Markdown / 批量导出 / 诊断</span>
              </div>

              <dl className="repo-card-grid">
                <div>
                  <dt>发布方式</dt>
                  <dd>GitHub Releases</dd>
                </div>
                <div>
                  <dt>桌面技术栈</dt>
                  <dd>React + Vite + Tauri</dd>
                </div>
                <div>
                  <dt>数据边界</dt>
                  <dd>本地缓存 + 手动 AI 调用</dd>
                </div>
                <div>
                  <dt>导出能力</dt>
                  <dd>Markdown / 批量导出 / 诊断</dd>
                </div>
              </dl>

              <div className="repo-card-footer">
                <div className="repo-card-footer-copy">
                  <span className="repo-card-footer-icon">
                    <Github aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <strong>项目已经开源于 GitHub</strong>
                    <p>欢迎查看 Issue、提交建议与反馈问题。</p>
                  </div>
                </div>
                <a className="repo-card-link" href={repositoryUrl} target="_blank" rel="noreferrer">
                  访问 GitHub
                  <ArrowRight aria-hidden="true" size={16} />
                </a>
              </div>
            </article>
          </div>

          <div className="trust-points">
            {trustPoints.map((item) => (
              <article key={item.title} className="trust-point">
                <span className="trust-point-icon">{item.icon}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="download-section" id="download">
          <div className="download-visual" aria-hidden="true">
            <img src={downloadDeskScene} alt="" />
          </div>
          <div className="download-copy">
            <h2>立即下载，开始你的本地阅读管理之旅</h2>
            <p>数据安全掌握在你手中，专注阅读，沉淀思考。</p>
          </div>
          <div className="download-actions">
            <a className="primary-button primary-button--stacked" href={releaseUrl} target="_blank" rel="noreferrer">
              <Download aria-hidden="true" size={18} />
              <span>
                <strong>下载 Windows 版</strong>
                <small>GitHub Releases</small>
              </span>
            </a>
            <a className="secondary-button" href={updateDocUrl}>
              查看更新说明
              <ArrowRight aria-hidden="true" size={16} />
            </a>
          </div>
          <ul className="download-meta" aria-label="下载说明">
            <li>完全免费</li>
            <li>开源透明</li>
            <li>定期更新</li>
          </ul>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-footer-brand">
          <span className="site-brand-mark">
            <BookOpen aria-hidden="true" size={18} />
          </span>
          <div>
            <strong>微信读书个人阅读管理</strong>
            <p>把微信读书里的书架、笔记和统计收进本地桌面。</p>
          </div>
        </div>

        <div className="site-footer-links">
          <a href="#features">功能</a>
          <a href="#screenshots">截图</a>
          <a href="#open-source">开源</a>
          <a href={releaseUrl} target="_blank" rel="noreferrer">
            更新日志
          </a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>

        <p className="site-footer-copy">© {currentYear} 微信读书个人阅读管理 · 本地优先 · 开源协作</p>
      </footer>
    </div>
  );
}
