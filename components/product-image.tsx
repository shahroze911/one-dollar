"use client";
import { useState } from "react";
import { imageUrl } from "@/lib/images";

const GRADS = [
  "from-emerald-400 to-teal-500",
  "from-sky-400 to-indigo-500",
  "from-amber-400 to-orange-500",
  "from-fuchsia-400 to-pink-500",
  "from-violet-400 to-purple-500",
  "from-rose-400 to-red-500",
];

/** Product photo, or a colourful initials tile when there is no photo. */
export default function ProductImage({
  name,
  path,
  className = "",
}: {
  name: string;
  path?: string | null;
  className?: string;
}) {
  const url = imageUrl(path);
  const [bad, setBad] = useState(false);

  if (url && !bad) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        loading="lazy"
        onError={() => setBad(true)}
        className={`object-cover ${className}`}
      />
    );
  }

  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <div className={`grid select-none place-items-center bg-gradient-to-br font-extrabold text-white ${GRADS[h % GRADS.length]} ${className}`}>
      {initials}
    </div>
  );
}
