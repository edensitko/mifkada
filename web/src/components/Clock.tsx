import { useEffect, useState } from "react";

/** שעון חי בפורמט מכשיר. */
export default function Clock({ seconds = true, className }: { seconds?: boolean; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), seconds ? 1000 : 30000);
    return () => clearInterval(id);
  }, [seconds]);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className={"mono ltr " + (className ?? "")}>
      {pad(now.getHours())}:{pad(now.getMinutes())}
      {seconds && <span className="opacity-60">:{pad(now.getSeconds())}</span>}
    </span>
  );
}
