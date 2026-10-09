import { getTranslations } from "next-intl/server";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";
import { CompanyForm } from "./company-form";

export default async function CompanySettingsPage() {
  const user = await requirePermission("data:read");
  const t = await getTranslations("company");
  const company = await getCompany();
  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <Card className="max-w-2xl">
        <CompanyForm
          readOnly={!can(user.role, "settings:manage")}
          initial={{
            name: company?.name ?? "",
            orgNumber: company?.orgNumber ?? "",
            legalForm: company?.legalForm ?? "",
            addressLine: company?.addressLine ?? "",
            postalCode: company?.postalCode ?? "",
            city: company?.city ?? "",
            email: company?.email ?? "",
            phone: company?.phone ?? "",
          }}
        />
      </Card>
    </>
  );
}
