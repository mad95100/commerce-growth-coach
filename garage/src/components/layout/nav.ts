import {
  BarChart3, Boxes, CalendarDays, Car, ClipboardCheck, ClipboardList, FileMinus, FileText, History, LayoutDashboard,
  Package, ReceiptText, Settings, ShoppingCart, Truck, Users, Wallet, Wrench, AlarmClock,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  perm: string | string[];
}

export const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Billing",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
      { to: "/invoices", label: "Invoices", icon: FileText, perm: "invoices.view" },
      { to: "/outstanding", label: "Outstanding", icon: AlarmClock, perm: "invoices.view" },
      { to: "/payments", label: "Payments", icon: Wallet, perm: "invoices.view" },
      { to: "/credit-notes", label: "Credit notes", icon: FileMinus, perm: "invoices.view" },
      { to: "/estimates", label: "Estimates", icon: ReceiptText, perm: "estimates.view" },
    ],
  },
  {
    group: "Workshop",
    items: [
      { to: "/job-cards", label: "Job cards", icon: Wrench, perm: ["job_cards.view", "job_cards.progress"] },
      { to: "/appointments", label: "Appointments", icon: CalendarDays, perm: "appointments.view" },
      { to: "/inspections", label: "Inspections", icon: ClipboardCheck, perm: "inspections.view" },
    ],
  },
  {
    group: "Customers",
    items: [
      { to: "/customers", label: "Customers", icon: Users, perm: "customers.view" },
      { to: "/vehicles", label: "Vehicles", icon: Car, perm: "customers.view" },
    ],
  },
  {
    group: "Inventory",
    items: [
      { to: "/parts", label: "Parts", icon: Package, perm: "catalog.view" },
      { to: "/services", label: "Services & labor", icon: ClipboardList, perm: "catalog.view" },
      { to: "/stock", label: "Stock", icon: Boxes, perm: "stock.view" },
      { to: "/suppliers", label: "Suppliers", icon: Truck, perm: "suppliers.view" },
      { to: "/purchase-orders", label: "Purchase orders", icon: ShoppingCart, perm: "suppliers.view" },
    ],
  },
  {
    group: "Business",
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, perm: "reports.view" },
      { to: "/audit", label: "Audit log", icon: History, perm: "audit.view" },
      { to: "/settings", label: "Settings", icon: Settings, perm: ["settings.manage", "users.manage", "staff.manage"] },
    ],
  },
];

export function allowed(perm: string | string[], can: (p: string) => boolean): boolean {
  return Array.isArray(perm) ? perm.some(can) : can(perm);
}
