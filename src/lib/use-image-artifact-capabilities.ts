import { useEffect, useState } from "react";
import {
  getImageArtifactCapabilities,
  resolveImageArtifactCapabilities,
  type ImageArtifactCapabilities
} from "./image-artifact-export";

export function useImageArtifactCapabilities(): ImageArtifactCapabilities {
  const [capabilities, setCapabilities] = useState<ImageArtifactCapabilities>(() =>
    getImageArtifactCapabilities()
  );

  useEffect(() => {
    let isMounted = true;

    async function loadCapabilities() {
      const nextCapabilities = await resolveImageArtifactCapabilities();
      if (isMounted) {
        setCapabilities(nextCapabilities);
      }
    }

    void loadCapabilities();

    return () => {
      isMounted = false;
    };
  }, []);

  return capabilities;
}
