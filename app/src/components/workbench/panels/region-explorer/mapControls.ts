import type maplibregl from "maplibre-gl";

// Two custom maplibregl.IControl instances, ported verbatim in spirit from
// the design prototype (prototypes/map-view-phase0-darjeeling.html's
// ThreeDToggleControl/RotateNudgeControl) — real map.addControl(...,
// "top-right") instances so MapLibre stacks them below the built-in
// zoom/compass group automatically, instead of guessing a fixed pixel
// offset. Exist because the only built-in way to pitch/rotate the map is a
// ctrl+drag gesture, which isn't discoverable.

// Standard isometric-cube "3D" glyph — same convention Google Maps/Earth use
// for their 3D-buildings/3D-view toggle.
const THREE_D_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z"/><path d="M12 3 L12 12 L20 7.5 M12 12 L4 7.5 M12 12 L12 21"/></svg>`;

export interface ThreeDToggleControl extends maplibregl.IControl {
  setActive: (active: boolean) => void;
}

/** Single button toggling the 3D terrain tilt — its own highlighted state (red fill) is the only "enabled" indicator, no text label, matching the prototype's .view3d-ctrl.active. */
export function createThreeDToggleControl(onToggle: () => void): ThreeDToggleControl {
  let container: HTMLDivElement;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group view3d-ctrl";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = "Toggle 3D view";
      btn.innerHTML = THREE_D_ICON_SVG;
      btn.addEventListener("click", onToggle);
      container.appendChild(btn);
      return container;
    },
    onRemove() {
      container.parentNode?.removeChild(container);
    },
    setActive(active: boolean) {
      container?.classList.toggle("active", active);
    },
  };
}

export interface RotateNudgeControl extends maplibregl.IControl {
  setVisible: (visible: boolean) => void;
}

/** Left/right bearing-nudge buttons ("simple navigation" instead of needing a drag gesture) — only shown while 3D is on, since bearing is meaningless in the flat top-down view. */
export function createRotateNudgeControl(): RotateNudgeControl {
  let container: HTMLDivElement;
  let mapInstance: maplibregl.Map;
  return {
    onAdd(map) {
      mapInstance = map;
      container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group rotate-ctrl";
      container.style.display = "none";
      const left = document.createElement("button");
      left.type = "button";
      left.title = "Rotate left";
      left.innerHTML = "&#8634;";
      left.addEventListener("click", () => mapInstance.easeTo({ bearing: mapInstance.getBearing() - 20, duration: 250 }));
      const right = document.createElement("button");
      right.type = "button";
      right.title = "Rotate right";
      right.innerHTML = "&#8635;";
      right.addEventListener("click", () => mapInstance.easeTo({ bearing: mapInstance.getBearing() + 20, duration: 250 }));
      container.appendChild(left);
      container.appendChild(right);
      return container;
    },
    onRemove() {
      container.parentNode?.removeChild(container);
    },
    setVisible(visible: boolean) {
      if (container) container.style.display = visible ? "" : "none";
    },
  };
}
