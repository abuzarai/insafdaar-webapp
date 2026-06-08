import React from "react";
import AdvocateNotificationsBell from "./AdvocateNotifications";

type Props = {
  title?: string;
  onGoToNotifications: () => void;
};

export default function AdvocateHeader({ title = "Advocate Dashboard", onGoToNotifications }: Props) {
  return (
    <header className="w-full bg-white border-b border-slate-200">
      <div className="h-16 px-4 md:px-6 flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-slate-900">{title}</h1>

        <div className="flex items-center gap-3">
          <AdvocateNotificationsBell onGoToNotifications={onGoToNotifications} />
        </div>
      </div>
    </header>
  );
}
