"use client";

import Image from "next/image";
import Link from "next/link";
import { House, LogOut, PhoneCall, Plug, Settings, Users, Zap } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { label: "Home", href: "/home", icon: House },
  { label: "Triggers", href: "/triggers", icon: Zap },
  { label: "Calls", href: "/calls", icon: PhoneCall },
  { label: "Connections", href: "/connections", icon: Plug },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

export function AppSidebar({
  active,
  user,
}: {
  active: (typeof navItems)[number]["label"];
  user: { name?: string; email?: string };
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const displayName = user.name?.trim() || user.email || "Account";
  const initial = displayName.charAt(0).toUpperCase();

  async function logOut() {
    setIsLoggingOut(true);
    setLogoutError(false);

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007"}/auth/logout`,
      { method: "POST", credentials: "include" },
    ).catch(() => null);

    if (!response?.ok) {
      setIsLoggingOut(false);
      setLogoutError(true);
      return;
    }

    window.location.replace("/login");
  }

  return (
    <Sidebar className="[--sidebar:#f7f7f5]">
      <SidebarHeader className="p-4">
        <Link href="/home" className="flex items-center gap-3 font-semibold">
          <Image src="/kyub-logo.png" alt="Kordy" width={32} height={32} className="rounded-md" />
          <span>Kordy</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Kordy</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={active === item.label}>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="h-auto py-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-sidebar-primary text-sm font-medium text-sidebar-primary-foreground">
                    {initial}
                  </span>
                  <span className="min-w-0 truncate font-medium">{displayName}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width)"
              >
                <DropdownMenuItem disabled={isLoggingOut} onSelect={() => void logOut()}>
                  <LogOut />
                  {isLoggingOut ? "Logging out…" : "Log out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {logoutError ? (
              <p className="px-2 pt-1 text-xs text-destructive" role="alert">
                Could not log out. Try again.
              </p>
            ) : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
