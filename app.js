"use strict";
//   1. CONFIGURACIÓN Y ESTADO
const CONFIG_URL = "./config.json";
const RECENT_MANUALS_KEY = "manualhub_recent_manuals";
const MAX_RECENT_MANUALS = 4;
const state = {
  devices: [],
  selectedDevice: null,
  selectedPort: null,
  currentView: "inicio"
};
//   2. REFERENCIAS AL HTML
const elements = {
  home: document.getElementById("view-home"),
  ports: document.getElementById("view-ports"),
  manual: document.getElementById("view-manual"),
  deviceGrid: document.getElementById("device-grid"),
  deviceCount: document.getElementById("device-count"),
  searchInput: document.getElementById("device-search"),
  portsTitle: document.getElementById("ports-title"),
  manualTitle: document.getElementById("manual-title"),
  manualDescription: document.getElementById("manual-description"),
  manualFilename: document.getElementById("manual-filename"),
  downloadButton: document.getElementById("download-button"),
  pdfViewer: document.getElementById("pdf-viewer"),
  openPdfButton: document.getElementById("open-pdf-button"),
  status: document.getElementById("status-panel"),
  latestManualsGrid: document.getElementById("latest-manuals-grid"),
  latestManualsCount: document.getElementById("latest-manuals-count"),
};
elements.searchInput.addEventListener("input", renderDevices);
//   3. MENSAJES Y UTILIDADES
function showStatus(message, type = "info") {
  elements.status.textContent = message;
  elements.status.dataset.type = type;
}
function clearStatus() {
  elements.status.textContent = "";
  delete elements.status.dataset.type;
}
// Escapa texto antes de insertarlo en una plantilla HTML.
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}
// Comprueba que las rutas apuntan a archivos locales dentro de pdfs/.
function getPDFUrl(path) {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("La ruta del PDF está vacía.");
  }
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path) ||
    /[?#\s]/.test(path)
  ) {
    throw new Error("La ruta del PDF no es válida.");
  }
  const segments = path.split("/");
  if (
    segments.length < 2 ||
    segments[0] !== "pdfs" ||
    segments.some(segment =>
      !segment ||
      segment === "." ||
      segment === ".." ||
      !/^[a-zA-Z0-9._-]+$/.test(segment)
    )
  ) {
    throw new Error(
      "Los manuales deben estar dentro de la carpeta pdfs."
    );
  }
  // Conserva las barras de la ruta y codifica cada segmento.
  return "./" + segments.map(encodeURIComponent).join("/");
}
//   4. CARGA DEL CATÁLOGO JSON
async function loadConfiguration() {
  showStatus("Cargando catálogo de dispositivos…");
  try {
    const response = await fetch(CONFIG_URL, {
      cache: "no-cache"
    });
    if (!response.ok) {
      throw new Error(
        `No se pudo cargar config.json: HTTP ${response.status}`
      );
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(
        "config.json debe contener una lista de dispositivos."
      );
    }
    const ids = new Set();
    state.devices = data.filter(device => {
      if (
        !device ||
        typeof device.id !== "string" ||
        !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(device.id) ||
        typeof device.nombre !== "string" ||
        !device.nombre.trim() ||
        ids.has(device.id)
      ) {
        console.warn("Dispositivo inválido o duplicado:", device);
        return false;
      }
      ids.add(device.id);
      // Validamos cada puerto de forma independiente.
      for (const key of ["aux_pdf", "usb_pdf"]) {
        if (typeof device[key] !== "string") {
          device[key] = "";
          continue;
        }
        if (device[key].trim()) {
          try {
            getPDFUrl(device[key]);
          } catch (error) {
            console.warn(
              `Ruta inválida para ${device.nombre}, ${key}:`,
              error.message
            );
            device[key] = "";
          }
        }
      }
      return true;
    });
    renderDevices();
    renderLatestManuals();
    if (state.devices.length === 0) {
      showStatus(
        "No hay dispositivos válidos en config.json.",
        "error"
      );
      return;
    }
    clearStatus();
    handleRoute();
  } catch (error) {
    console.error("Error al cargar el catálogo:", error);
    showStatus(
      "No se pudo cargar el catálogo. Comprueba config.json, " +
      "su formato JSON y que el servidor local esté funcionando.",
      "error"
    );
  }
}
//   5. VISTA 1: ÍNDICE DE DISPOSITIVOS
function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function getRecentManuals() {
  try {
    const saved = localStorage.getItem(RECENT_MANUALS_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Solo conservamos entradas válidas que sigan existiendo
    // en el catálogo actual.
    const validManuals = parsed.filter(item => {
      if (
        !item ||
        typeof item.deviceId !== "string" ||
        typeof item.path !== "string" ||
        !["aux", "usb"].includes(item.port)
      ) {
        return false;
      }
      const device = state.devices.find(
        device => device.id === item.deviceId
      );
      return device && device[item.port + "_pdf"] === item.path;
    });
    return validManuals.slice(0, MAX_RECENT_MANUALS);
  } catch {
    return [];
  }
}
function recordRecentManual(device, port, path) {
  if (
    !device ||
    !["aux", "usb"].includes(port) ||
    typeof path !== "string" ||
    !path.trim()
  ) {
    return;
  }
  try {
    const previous = getRecentManuals();
    // Eliminamos el mismo documento antes de ponerlo el primero.
    const updated = previous.filter(item => item.path !== path);
    updated.unshift({
      deviceId: device.id,
      path,
      port,
      viewedAt: Date.now()
    });
    localStorage.setItem(
      RECENT_MANUALS_KEY,
      JSON.stringify(updated.slice(0, MAX_RECENT_MANUALS))
    );
  } catch {
    // Si el navegador bloquea el almacenamiento, el visor
    // debe seguir funcionando con normalidad.
  }
}
function renderLatestManuals() {
  const recentManuals = getRecentManuals();
  elements.latestManualsCount.textContent =
    `${recentManuals.length} ${
      recentManuals.length === 1 ? "manual" : "manuales"
    }`;
  if (recentManuals.length === 0) {
    elements.latestManualsGrid.innerHTML = `
      <div class="latest-manuals-empty">
        Todavía no has consultado ningún manual.
        Los documentos que abras aparecerán aquí.
      </div>
    `;
    return;
  }
  elements.latestManualsGrid.innerHTML = recentManuals.map(manual => {
    const device = state.devices.find(
      item => item.id === manual.deviceId
    );
    if (!device) {
      return "";
    }
    const portLabel = manual.port.toUpperCase();
    return `
      <button
        class="latest-manual-card"
        type="button"
        data-latest-device-id="${escapeHTML(device.id)}"
        data-latest-port="${manual.port}"
        aria-label="Volver a consultar el manual de ${escapeHTML(device.nombre)}, conexión ${portLabel}"
      >
        <span class="latest-manual-icon" aria-hidden="true">PDF</span>
        <span class="latest-manual-content">
          <strong>${escapeHTML(device.nombre)}</strong>
          <span class="latest-manual-device">Manual de configuración</span>
          <span class="latest-manual-port">${portLabel}</span>
        </span>
      </button>
    `;
  }).join("");
}
elements.latestManualsGrid.addEventListener("click", event => {
  const manualButton = event.target.closest("[data-latest-device-id]");
  if (!manualButton) {
    return;
  }
  const deviceId = manualButton.dataset.latestDeviceId;
  const port = manualButton.dataset.latestPort;
  // Si el buscador oculta el dispositivo, lo hacemos visible
  // para poder reutilizar la navegación que ya tiene el portal.
  if (elements.searchInput.value !== "") {
    elements.searchInput.value = "";
    renderDevices();
  }
  const deviceButton = Array.from(
    elements.deviceGrid.querySelectorAll("[data-device-id]")
  ).find(button => button.dataset.deviceId === deviceId);
  if (!deviceButton) {
    return;
  }
  // Reutilizamos la selección de dispositivo ya existente.
  deviceButton.click();
  // La vista de puertos se actualiza con la navegación actual.
  const portButton = elements.ports.querySelector(
    `[data-port="${port}"]`
  );
  if (portButton && !portButton.hidden) {
    portButton.click();
  }
});
function renderDevices() {
  const searchTerm = normalizeSearchText(
    elements.searchInput.value
  );
  const filteredDevices = state.devices.filter(device =>
    normalizeSearchText(device.nombre).includes(searchTerm)
  );
  elements.deviceCount.textContent =
    `${filteredDevices.length} ${
      filteredDevices.length === 1
        ? "dispositivo"
        : "dispositivos"
    }`;
  if (state.devices.length === 0) {
    elements.deviceGrid.innerHTML = `
      <div class="empty-state">
        No hay dispositivos disponibles.
      </div>
    `;
    return;
  }
  if (filteredDevices.length === 0) {
    elements.deviceGrid.innerHTML = `
      <div class="empty-state">
        No se han encontrado dispositivos con ese nombre.
      </div>
    `;
    return;
  }
  elements.deviceGrid.innerHTML = filteredDevices.map(device => {
    const hasAux =
      typeof device.aux_pdf === "string" &&
      device.aux_pdf.trim() !== "";
    const hasUsb =
      typeof device.usb_pdf === "string" &&
      device.usb_pdf.trim() !== "";
    const ports = [
      hasAux ? '<span class="device-port-badge">AUX</span>' : "",
      hasUsb ? '<span class="device-port-badge">USB</span>' : ""
    ].filter(Boolean).join("");
    const availablePorts = [
      hasAux ? "AUX" : "",
      hasUsb ? "USB" : ""
    ].filter(Boolean).join(", ") || "ninguna";
    return `
      <button
        class="device-card"
        type="button"
        data-device-id="${escapeHTML(device.id)}"
        aria-label="Consultar manuales de ${escapeHTML(device.nombre)}. Conexiones disponibles: ${availablePorts}"
      >
        <span class="device-icon" aria-hidden="true">▤</span>
        <span class="device-card-content">
          <strong>${escapeHTML(device.nombre)}</strong>
          <span class="card-arrow" aria-hidden="true">→</span>
        </span>
        <span class="device-ports" aria-label="Conexiones disponibles">
          ${ports}
        </span>
      </button>
    `;
  }).join("");
}
//   6. NAVEGACIÓN ENTRE LAS TRES VISTAS
function showView(viewName) {
  const views = {
    inicio: elements.home,
    puertos: elements.ports,
    manual: elements.manual
  };
  if (!views[viewName]) {
    viewName = "inicio";
  }
  Object.entries(views).forEach(([name, element]) => {
    const active = name === viewName;
    element.hidden = !active;
    element.classList.toggle("is-active", active);
    element.setAttribute("aria-hidden", String(!active));
  });
  state.currentView = viewName;
  clearStatus();
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches ? "auto" : "smooth"
  });
}
function navigate(route) {
  if (window.location.hash !== route) {
    window.location.hash = route;
  } else {
    handleRoute();
  }
}
// URL admitidas:
// #inicio
// #/dispositivo/magellan-9300i
// #/dispositivo/magellan-9300i/aux
// #/dispositivo/magellan-9300i/usb
function handleRoute() {
  const parts = window.location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length === 0 || parts[0] === "inicio") {
    showView("inicio");
    return;
  }
  if (parts[0] !== "dispositivo" || !parts[1]) {
    navigate("#inicio");
    return;
  }
  const device = state.devices.find(
    item => item.id === parts[1]
  );
  if (!device) {
    navigate("#inicio");
    return;
  }
  state.selectedDevice = device;
  // Vista 2: selección de puerto.
  if (parts.length === 2) {
    state.selectedPort = null;
    renderPorts();
    showView("puertos");
    return;
  }
  // Vista 3: visor del puerto seleccionado.
  const port = parts[2];
  if (
    parts.length === 3 &&
    (port === "aux" || port === "usb")
  ) {
    state.selectedPort = port;
    if (!getSelectedPDF()) {
      navigate(`#/dispositivo/${device.id}`);
      showStatus(
        `El manual ${port.toUpperCase()} no está disponible.`,
        "error"
      );
      return;
    }
    showView("manual");
    renderManual();
    return;
  }
  navigate("#inicio");
}
//   7. VISTA 2: SELECCIÓN AUX / USB
function renderPorts() {
    const device = state.selectedDevice;
    if (!device) return;
    document.querySelectorAll("#view-ports [data-port]").forEach((button) => {
        const port = button.dataset.port;
        const pdf = port === "aux"
            ? device.aux_pdf
            : device.usb_pdf;
        button.hidden = !(typeof pdf === "string" && pdf.trim() !== "");
    });
}
//   8. OBTENER EL PDF DEL PUERTO ELEGIDO
function getSelectedPDF() {
  const device = state.selectedDevice;
  const port = state.selectedPort;
  if (!device || !port) {
    return null;
  }
  // IMPORTANTE:
  // AUX obtiene exclusivamente aux_pdf.
  // USB obtiene exclusivamente usb_pdf.
  const key = port === "aux" ? "aux_pdf" : "usb_pdf";
  const path = device[key];
  if (!path) {
    return null;
  }
  try {
    return getPDFUrl(path);
  } catch (error) {
    console.error("Error en la ruta del PDF:", error);
    return null;
  }
}
//   9. VISTA 3: VISOR Y DESCARGA
function renderManual() {
  const device = state.selectedDevice;
  const port = state.selectedPort;
  const pdfUrl = getSelectedPDF();
  if (!device || !port || !pdfUrl) {
    showStatus("No se ha podido encontrar el manual.", "error");
    return;
  }
  const portName = port.toUpperCase();
  // El nombre y la ruta se obtienen del puerto seleccionado.
  const key = port === "aux" ? "aux_pdf" : "usb_pdf";
  const filename = device[key].split("/").pop();
  elements.manualTitle.textContent =
    `${device.nombre} · Puerto ${portName}`;
  elements.manualDescription.textContent =
    `Manual de configuración para la conexión ${portName}.`;
  elements.manualFilename.textContent = filename;
  // Descarga del mismo PDF que aparece en el visor.
  elements.downloadButton.href = pdfUrl;
  elements.downloadButton.download = filename;
  const absolutePdfUrl = new URL(pdfUrl, document.baseURI).href;
  elements.openPdfButton.href = absolutePdfUrl;
  elements.openPdfButton.target = "_blank";
  elements.openPdfButton.rel = "noopener noreferrer";
  elements.openPdfButton.setAttribute(
    "aria-label",
    `Abrir el manual ${filename} en otra pestaña`
  );
  // Evitamos conservar un documento anterior en el iframe.
  elements.pdfViewer.src = pdfUrl;
  // Guardar la ruta original del catálogo para poder validar
  // correctamente el historial contra config.json.
  const manualPath = device[`${port}_pdf`];
  recordRecentManual(device, port, manualPath);
  renderLatestManuals();
}
//   10. EVENTOS DE LOS DISPOSITIVOS
// Delegación de eventos: funciona también con tarjetas dinámicas.
elements.deviceGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-device-id]");
  if (!button) return;
  const device = state.devices.find(
    item => item.id === button.dataset.deviceId
  );
  if (!device) return;
  state.selectedDevice = device;
  state.selectedPort = null;
  navigate(`#/dispositivo/${device.id}`);
});
//   11. EVENTOS DE LOS PUERTOS
document.querySelectorAll("[data-port]").forEach(button => {
  button.addEventListener("click", () => {
    if (!state.selectedDevice || button.disabled) {
      return;
    }
    const port = button.dataset.port;
    const key = port === "aux" ? "aux_pdf" : "usb_pdf";
    if (!state.selectedDevice[key]) {
      showStatus(
        `El manual ${port.toUpperCase()} no está disponible o no existe por esa conexión.`,
        "error"
      );
      return;
    }
    state.selectedPort = port;
    // La URL incluye el puerto seleccionado.
    // Nunca se fuerza USB al seleccionar AUX.
    navigate(`# /dispositivo/${state.selectedDevice.id}/${port}`
      .replace("# /", "#/"));
  });
});
//   12. BOTONES PARA VOLVER ATRÁS
document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "home") {
      navigate("#inicio");
    }
    if (action === "ports" && state.selectedDevice) {
      navigate(`#/dispositivo/${state.selectedDevice.id}`);
    }
  });
});
//   13. ATRÁS / ADELANTE DEL NAVEGADOR
window.addEventListener("hashchange", handleRoute);
//   14. INICIALIZACIÓN
loadConfiguration();