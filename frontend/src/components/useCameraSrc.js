import { useEffect, useState } from "react";
import { api } from "../api.js";

const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

// Image URL for a camera tile: the default frame, or the user-uploaded media that replaced it
// ("Log violations to..."). The upload needs the auth header, so it is fetched as a blob.
export default function useCameraSrc(camera) {
  const [customUrl, setCustomUrl] = useState(null);
  useEffect(() => {
    if (!camera.sourceVersion) {
      setCustomUrl(null);
      return;
    }
    let cancelled = false;
    let url = null;
    api
      .getCameraSource(camera.id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setCustomUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [camera.id, camera.sourceVersion]);

  return camera.sourceVersion ? customUrl || BLANK : `/cameras/${camera.image}`;
}
