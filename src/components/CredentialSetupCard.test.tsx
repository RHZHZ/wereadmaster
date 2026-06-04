import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "./ToastProvider";
import { BookshelfPage } from "../pages/BookshelfPage";
import { NotesPage } from "../pages/NotesPage";
import { StatisticsPage } from "../pages/StatisticsPage";
import { DiscoveryPage } from "../pages/DiscoveryPage";
import { CandidateBookshelfPage } from "../pages/CandidateBookshelfPage";

describe("credential setup onboarding reuse", () => {
  it("renders the shared onboarding artwork in every missing-credential entry page", () => {
    const pages = [
      renderToStaticMarkup(
        <ToastProvider>
          <BookshelfPage
            credentialStatus={{ hasCredential: false }}
            isLoading={false}
            isSyncing={false}
            onSync={() => undefined}
            onOpenSettings={() => undefined}
            onOpenDetail={() => undefined}
            onSearchInDiscovery={() => undefined}
          />
        </ToastProvider>
      ),
      renderToStaticMarkup(
        <ToastProvider>
          <NotesPage
            credentialStatus={{ hasCredential: false }}
            onOverviewChange={() => undefined}
            onOpenSettings={() => undefined}
            onOpenBookNotes={() => undefined}
          />
        </ToastProvider>
      ),
      renderToStaticMarkup(
        <ToastProvider>
          <StatisticsPage
            credentialStatus={{ hasCredential: false }}
            cache={{}}
            onCacheChange={() => undefined}
            onOpenSettings={() => undefined}
            onOpenReview={() => undefined}
          />
        </ToastProvider>
      ),
      renderToStaticMarkup(
        <ToastProvider>
          <DiscoveryPage
            credentialStatus={{ hasCredential: false }}
            readingStatsCache={{}}
            onOpenSettings={() => undefined}
            onOpenBookDetail={() => undefined}
            onOpenCandidateShelf={() => undefined}
          />
        </ToastProvider>
      ),
      renderToStaticMarkup(
        <ToastProvider>
          <CandidateBookshelfPage
            credentialStatus={{ hasCredential: false }}
            readingStatsCache={{}}
            onOpenSettings={() => undefined}
            onOpenDiscovery={() => undefined}
            onOpenBookDetail={() => undefined}
            onBookDecisionGenerated={() => undefined}
          />
        </ToastProvider>
      )
    ];

    pages.forEach((markup) => {
      expect(markup).toContain("onboarding-local-vault");
      expect(markup).toContain("页面不会显示已保存密钥");
      expect(markup).toContain("打开设置");
    });
  });
});
