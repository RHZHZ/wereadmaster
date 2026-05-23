import onboardingLocalVault from "../assets/generated/onboarding-local-vault.png";

type CredentialSetupCardProps = {
  title: string;
  description: string;
  onOpenSettings: () => void;
};

export function CredentialSetupCard({
  title,
  description,
  onOpenSettings
}: CredentialSetupCardProps) {
  return (
    <section className="setup-card credential-setup-card" aria-label="需要设置 API Key">
      <img src={onboardingLocalVault} alt="" />
      <div className="credential-setup-copy">
        <p className="section-kicker">首次绑定</p>
        <h3>{title}</h3>
        <p>{description}</p>
        <p>API Key 只保存在当前设备，前端页面不会读取或展示明文。</p>
      </div>
      <button className="secondary-action" type="button" onClick={onOpenSettings}>
        打开设置
      </button>
    </section>
  );
}
