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
  X
} from "lucide-react";
import shelfView from "../src/assets/shelf.png";
import notesView from "../src/assets/notes.png";
import settingsView from "../src/assets/generated/set.png";
const heroDeskScene = shelfView;
const downloadDeskScene = settingsView;

const repositoryUrl = "https://github.com/RHZHZ/wereadmaster";
const releaseUrl = "https://github.com/RHZHZ/wereadmaster/releases";
const updateDocUrl = "https://github.com/RHZHZ/wereadmaster/blob/main/docs/github-release-updates.md";

const navItems = [
  { id: "top", label: "首页" },
  { id: "features", label: "功能" },
  { id: "screenshots", label: "截图" },
  { id: "faq", label: "FAQ" },
  { id: "open-source", label: "开源" },
  { id: "download", label: "下载" }
] as const;

const heroTrustPoints = [
  { desktop: "GitHub Releases 分发", mobile: "Releases 分发" },
  { desktop: "开源可查", mobile: "开源可查" },
  { desktop: "Key 保存在本机", mobile: "Key 本机保存" }
] as const;

const valuePillars = [
  {
    icon: <Cloud aria-hidden="true" size={22} />,
    title: "同步书架",
    description: "手动同步微信读书书架、分类和阅读状态。"
  },
  {
    icon: <NotebookPen aria-hidden="true" size={22} />,
    title: "整理笔记",
    description: "查看划线、想法和章节位置，复盘前先把材料理清楚。"
  },
  {
    icon: <Sparkles aria-hidden="true" size={22} />,
    title: "生成复盘",
    description: "你手动触发时，基于本地笔记生成书籍复盘。"
  },
  {
    icon: <FileOutput aria-hidden="true" size={22} />,
    title: "导出 Markdown",
    description: "把笔记、复盘和报告带到自己的写作系统。"
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
    title: "查看书架数量、分类和阅读状态",
    description: "同步后先看总览，再按类型、分类和阅读状态筛选。",
    image: shelfView,
    guidePoints: ["左侧导航对应书架、笔记、统计和复盘", "顶部统计显示电子书、有声书、收藏和私密数量", "分类筛选和搜索帮助你快速找到下一本书"]
  },
  {
    id: "notes",
    badge: "笔记详情",
    title: "查看划线、想法和章节位置",
    description: "围绕单本书整理摘录，导出前先确认来源和上下文。",
    image: notesView,
    guidePoints: ["划线和想法按章节归拢", "单条摘录可导出图片", "复盘问题可以回到来源摘录继续追问"]
  },
  {
    id: "settings",
    badge: "本地设置",
    title: "集中管理同步、AI 和导出边界",
    description: "Key、Provider、导出目录和维护操作都放在本机设置里。",
    image: settingsView,
    guidePoints: ["API Key 保存在本机", "AI Provider 可手动配置", "导出目录和维护操作集中处理"]
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

const desktopReasons = [
  {
    icon: <Cloud aria-hidden="true" size={22} />,
    title: "本地缓存",
    description: "书架、笔记和统计优先写入本机数据库，后续整理不依赖网页会话。"
  },
  {
    icon: <LockKeyhole aria-hidden="true" size={22} />,
    title: "安全存储",
    description: "微信读书 API Key 和 AI API Key 放在本机安全存储中，不在页面明文展示。"
  },
  {
    icon: <FileOutput aria-hidden="true" size={22} />,
    title: "长期整理",
    description: "复盘、候选书和导出文件可以持续积累，适合长期维护自己的阅读工作台。"
  }
] as const;

const faqItems = [
  {
    question: "支持哪些平台？",
    answer: "当前提供 Windows 桌面端和 Android 签名 APK，安装包通过 GitHub Releases 分发。"
  },
  {
    question: "为什么不能直接在网页里使用？",
    answer:
      "应用需要管理本地数据库、导出目录和安全存储中的 Key。桌面端更适合长期保存阅读数据，也能减少把阅读内容交给网页服务托管。"
  },
  {
    question: "是否必须配置微信读书 API Key？",
    answer: "需要。同步书架、笔记和统计前，需要在设置里填入微信读书 Skill 页面提供的 API Key。"
  },
  {
    question: "是否必须配置 AI Provider？",
    answer:
      "不必须。书架、笔记、统计和导出可以先使用；AI 复盘、阅读助手等功能需要你在本机配置自己的 AI Provider 和 Key。"
  },
  {
    question: "我的阅读内容会自动上传吗？",
    answer:
      "不会。应用只在你主动同步或主动生成 AI 内容时执行对应动作。AI 调用也只在你点击生成时发送确认范围内的内容。"
  },
  {
    question: "下载是否免费？",
    answer: "项目当前开源发布，安装包在 GitHub Releases 获取。后续发布策略以项目说明为准。"
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
                <span className="site-nav-download-copy-desktop">下载 Windows 版</span>
                <span className="site-nav-download-copy-mobile">下载 Android 版</span>
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
              <h1>微信读书本地管理工具</h1>
              <p>
                同步书架、笔记和统计，在本机整理 AI 读书复盘，并导出 Markdown。Windows 桌面端优先，Android 版同步发布。
              </p>
              <div className="hero-actions">
                <a className="primary-button primary-button--stacked" href={releaseUrl} target="_blank" rel="noreferrer">
                  <Download aria-hidden="true" size={18} />
                  <span>
                    <strong>
                      <span className="cta-copy-desktop">下载 Windows 版</span>
                      <span className="cta-copy-mobile">下载 Android 版</span>
                    </strong>
                    <small className="cta-subtitle-desktop">GitHub Releases</small>
                    <small className="cta-subtitle-mobile">签名 APK</small>
                  </span>
                </a>
                <a className="secondary-button secondary-button--stacked" href={repositoryUrl} target="_blank" rel="noreferrer">
                  <span>
                    <strong>查看 GitHub 项目</strong>
                    <small className="cta-secondary-note">GitHub</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={16} />
                </a>
              </div>
              <p className="mobile-download-note">双端安装包在 GitHub Releases。</p>
              <ul className="hero-proof-list" aria-label="产品要点">
                {heroTrustPoints.map((point) => (
                  <li key={point.desktop}>
                    <span className="trust-copy-desktop">{point.desktop}</span>
                    <span className="trust-copy-mobile">{point.mobile}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hero-product-preview" aria-label="微信读书书架管理界面预览">
              <img src={shelfView} alt="微信读书书架管理界面" />
            </div>
          </div>
        </section>

        <section className="value-section" id="features">
          <div className="section-intro">
            <h2>专为重度阅读者打造的本地阅读工作台</h2>
            <p>先把书架、笔记和复盘整理清楚，再把需要的内容导出。</p>
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
            <h2>从同步到导出，路径保持简单</h2>
            <p>每一步都由你主动触发，不做自动化承诺。</p>
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
                  <ul className="screenshots-guide-list" aria-label={`${activeShowcase.badge}截图导读`}>
                    {activeShowcase.guidePoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
                <div className="screenshots-carousel-dots" aria-label="产品截图切换">
                  {showcaseSlides.map((slide, index) => (
                    <button
                      key={slide.id}
                      type="button"
                      className={`screenshots-carousel-tab ${index === activeShowcaseIndex ? "is-active" : ""}`}
                      aria-label={`查看${slide.badge}`}
                      aria-pressed={index === activeShowcaseIndex}
                      onClick={() => setActiveShowcaseIndex(index)}
                    >
                      {slide.badge}
                    </button>
                  ))}
                </div>
              </div>
            </article>
          </div>
        </section>

        <section className="desktop-rationale-section" aria-label="为什么需要桌面端">
          <div className="section-intro">
            <h2>为什么是桌面端？</h2>
            <p>
              阅读笔记、AI Key、导出目录和本地数据库都更适合放在自己的设备上。
            </p>
          </div>
          <div className="desktop-rationale-grid">
            {desktopReasons.map((item) => (
              <article key={item.title} className="desktop-rationale-item">
                <span className="desktop-rationale-icon">{item.icon}</span>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div className="section-intro section-intro--left">
            <h2>下载前常见问题</h2>
            <p>先确认平台、Key、AI 和数据边界，再决定是否安装。</p>
          </div>
          <div className="faq-list">
            {faqItems.map((item) => (
              <details key={item.question} className="faq-item">
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="trust-section" id="open-source">
          <div className="trust-lead">
            <div className="section-intro section-intro--left">
              <h2>开源透明</h2>
              <p>代码公开在 GitHub，下载通过 Releases 分发，关键数据优先留在本机。</p>
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
                    <p className="repo-card-summary">微信读书个人阅读管理 · React + Vite + Tauri</p>
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
            <h2>下载 Windows 与 Android 版</h2>
            <p>通过 GitHub Releases 获取 Windows 安装包和 Android 签名 APK。</p>
          </div>
          <div className="download-actions">
            <a className="primary-button primary-button--stacked" href={releaseUrl} target="_blank" rel="noreferrer">
              <Download aria-hidden="true" size={18} />
              <span>
                <strong>
                  <span className="cta-copy-desktop">下载 Windows 版</span>
                  <span className="cta-copy-mobile">下载 Android 版</span>
                </strong>
                <small className="cta-subtitle-desktop">GitHub Releases</small>
                <small className="cta-subtitle-mobile">签名 APK</small>
              </span>
            </a>
            <a className="secondary-button" href={updateDocUrl} target="_blank" rel="noreferrer">
              查看更新说明
              <ArrowRight aria-hidden="true" size={16} />
            </a>
          </div>
          <ul className="download-meta" aria-label="下载说明">
            <li>Windows 桌面应用</li>
            <li>Android 签名 APK</li>
            <li>GitHub Releases 分发</li>
            <li>可查看更新说明</li>
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
          <a href="#faq">FAQ</a>
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
