/* ==========================================================================
   Bayshore Gifts & Gallery: Content Manager (admin SPA)
   One owner login. Edits the DRAFT copy of the site content, can PREVIEW it
   on the live site, and PUBLISH to promote draft -> published.

   Flows:
     load -> GET /api/me
       !hasAdmin            -> SETUP screen  (create password)
       hasAdmin && !authed  -> LOGIN screen
       authed               -> DASHBOARD     (GET /api/content?state=draft)

   No em dashes or en dashes in UI copy. WCAG AA. Resilient to fetch failures.
   ========================================================================== */
(function () {
  "use strict";

  // ----- tiny DOM helpers ------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      });
    }
    appendChildren(node, children);
    return node;
  }
  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  var $app = document.getElementById("app");

  // ----- API layer -------------------------------------------------------
  function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || "GET",
      credentials: "include",
      headers: {},
    };
    if (opts.body !== undefined) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (res) {
      var ct = res.headers.get("content-type") || "";
      var parse = ct.indexOf("application/json") >= 0
        ? res.json().catch(function () { return null; })
        : Promise.resolve(null);
      return parse.then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  // ----- toast -----------------------------------------------------------
  var $toast = document.getElementById("toast");
  var toastTimer = null;
  function toast(msg, kind) {
    $toast.textContent = msg;
    $toast.className = "toast" + (kind ? " is-" + kind : "");
    $toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.hidden = true; }, 4200);
  }

  // ----- confirm modal (keyboard accessible) -----------------------------
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var lastFocus = document.activeElement;
      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); close(false); }
        if (e.key === "Tab") {
          // trap focus inside the modal
          var f = modal.querySelectorAll("button");
          if (!f.length) return;
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      var confirmBtn = el("button", {
        class: "btn " + (opts.danger ? "btn-danger" : "btn-primary"),
        onclick: function () { close(true); },
      }, opts.confirmLabel || "Confirm");
      var cancelBtn = el("button", {
        class: "btn btn-ghost",
        onclick: function () { close(false); },
      }, opts.cancelLabel || "Cancel");
      var modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "cf-title" }, [
        el("h2", { id: "cf-title" }, opts.title || "Are you sure?"),
        el("p", null, opts.message || ""),
        el("div", { class: "modal-actions" }, [cancelBtn, confirmBtn]),
      ]);
      var backdrop = el("div", { class: "modal-backdrop", onclick: function (e) { if (e.target === backdrop) close(false); } }, modal);
      document.body.appendChild(backdrop);
      document.addEventListener("keydown", onKey, true);
      confirmBtn.focus();
    });
  }

  // ======================================================================
  //  BOOT
  // ======================================================================
  function boot() {
    api("/api/me").then(function (r) {
      if (!r.ok || !r.data) {
        return showFatal("We could not reach the content manager. Please refresh the page to try again.");
      }
      if (!r.data.hasAdmin) return renderSetup();
      if (!r.data.authed) return renderLogin();
      return loadDashboard();
    }).catch(function () {
      showFatal("We could not reach the content manager. Please check your connection and refresh the page.");
    });
  }

  function showFatal(msg) {
    clear($app);
    $app.appendChild(el("main", { class: "auth-wrap", id: "main" }, [
      el("div", { class: "auth-card" }, [
        el("p", { class: "auth-mark" }, "Bayshore"),
        el("div", { class: "inline-error" }, msg),
        el("button", { class: "btn btn-primary btn-block", onclick: function () { location.reload(); } }, "Refresh"),
      ]),
    ]));
  }

  // ======================================================================
  //  SETUP SCREEN (first run)
  // ======================================================================
  function renderSetup() {
    clear($app);
    var errBox = el("div", { class: "inline-error", hidden: true });
    var pw = el("input", { type: "password", id: "su-pw", autocomplete: "new-password", minlength: "8", required: true });
    var pw2 = el("input", { type: "password", id: "su-pw2", autocomplete: "new-password", minlength: "8", required: true });
    var submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, "Create password and start");

    function fail(msg) { errBox.textContent = msg; errBox.hidden = false; }

    var form = el("form", {
      novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        errBox.hidden = true;
        var a = pw.value, b = pw2.value;
        if (a.length < 8) return fail("Please choose a password of at least 8 characters.");
        if (a !== b) return fail("The two passwords do not match. Please try again.");
        submit.disabled = true; submit.textContent = "Setting up...";
        api("/api/setup", { method: "POST", body: { password: a } }).then(function (r) {
          if (r.ok && r.data && r.data.ok) { toast("Welcome. Your manager is ready.", "success"); return loadDashboard(); }
          submit.disabled = false; submit.textContent = "Create password and start";
          if (r.status === 409) return fail("This site already has a password set. Please reload and sign in.");
          fail((r.data && r.data.error) ? prettyErr(r.data.error) : "Setup failed. Please try again.");
        }).catch(function () {
          submit.disabled = false; submit.textContent = "Create password and start";
          fail("We could not reach the server. Please check your connection and try again.");
        });
      },
    }, [
      el("div", { class: "field" }, [
        el("label", { for: "su-pw" }, "Create a password"),
        pw,
        el("span", { class: "hint" }, "At least 8 characters. Write it down somewhere safe. There is no email reset."),
      ]),
      el("div", { class: "field" }, [
        el("label", { for: "su-pw2" }, "Type it again"),
        pw2,
      ]),
      errBox,
      submit,
    ]);

    $app.appendChild(el("main", { class: "auth-wrap", id: "main" }, [
      el("div", { class: "auth-card" }, [
        el("p", { class: "auth-mark" }, "Bayshore"),
        el("h1", null, "Set up your content manager"),
        el("p", { class: "auth-sub" }, "Create one password for the shop. You will use it to edit and publish your website."),
        form,
      ]),
    ]));
    pw.focus();
  }

  // ======================================================================
  //  LOGIN SCREEN
  // ======================================================================
  function renderLogin() {
    clear($app);
    var errBox = el("div", { class: "inline-error", hidden: true });
    var pw = el("input", { type: "password", id: "li-pw", autocomplete: "current-password", required: true });
    var submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, "Sign in");

    function fail(msg) { errBox.textContent = msg; errBox.hidden = false; }

    var form = el("form", {
      novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        errBox.hidden = true;
        if (!pw.value) return fail("Please enter your password.");
        submit.disabled = true; submit.textContent = "Signing in...";
        api("/api/login", { method: "POST", body: { password: pw.value } }).then(function (r) {
          if (r.ok && r.data && r.data.ok) { toast("Signed in.", "success"); return loadDashboard(); }
          submit.disabled = false; submit.textContent = "Sign in";
          if (r.status === 409 && r.data && r.data.needsSetup) return renderSetup();
          if (r.status === 401) return fail("That password did not match. Please try again.");
          fail("Sign in failed. Please try again.");
        }).catch(function () {
          submit.disabled = false; submit.textContent = "Sign in";
          fail("We could not reach the server. Please check your connection and try again.");
        });
      },
    }, [
      el("div", { class: "field" }, [
        el("label", { for: "li-pw" }, "Password"),
        pw,
      ]),
      errBox,
      submit,
    ]);

    $app.appendChild(el("main", { class: "auth-wrap", id: "main" }, [
      el("div", { class: "auth-card" }, [
        el("p", { class: "auth-mark" }, "Bayshore"),
        el("h1", null, "Sign in"),
        el("p", { class: "auth-sub" }, "Enter your shop password to edit your website."),
        form,
      ]),
    ]));
    pw.focus();
  }

  function prettyErr(code) {
    var map = {
      already_configured: "This site already has a password set.",
      unauthorized: "You are not signed in.",
    };
    return map[code] || code;
  }

  // ======================================================================
  //  DASHBOARD STATE
  // ======================================================================
  var state = {
    content: null,        // working draft (mutated in place by editors)
    activePanel: "site",
    dirty: false,         // unsaved changes since last save
    saving: false,
    publishedHash: null,  // hash of the live (published) content, if known
    publishedKnown: false,// whether we successfully read the published content
  };
  var statusPill = null;

  // Stable stringify so key order never changes the hash, then a small
  // djb2-style hash. Used only to tell "saved draft" from "what is live".
  function contentHash(value) {
    var str = stableStringify(value);
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return String(h >>> 0);
  }
  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return "[" + value.map(stableStringify).join(",") + "]";
    }
    var keys = Object.keys(value).sort();
    return "{" + keys.map(function (k) {
      return JSON.stringify(k) + ":" + stableStringify(value[k]);
    }).join(",") + "}";
  }
  // True only when we know the live site and it differs from the saved draft.
  function draftAheadOfLive() {
    if (!state.publishedKnown || state.publishedHash == null) return false;
    return contentHash(state.content) !== state.publishedHash;
  }

  function markDirty() {
    state.dirty = true;
    setStatus("unsaved");
  }
  // After a clean save (or on load with no unsaved edits), show either
  // "Draft saved" or, if the saved draft is ahead of the live site,
  // "Saved draft not yet published" so the owner is never misled.
  function setSavedStatus() {
    if (draftAheadOfLive()) setStatus("unpublished");
    else setStatus("saved");
  }
  function setStatus(kind, label) {
    if (!statusPill) return;
    var dot = el("span", { class: "dot" });
    var text = label;
    var cls = "status-pill";
    if (kind === "unsaved") { cls += " is-unsaved"; text = text || "Unsaved changes"; }
    else if (kind === "saved") { cls += " is-saved"; text = text || "Draft saved"; }
    else if (kind === "unpublished") { cls += " is-unpublished"; text = text || "Saved draft not yet published"; }
    else if (kind === "published") { cls += " is-published"; text = text || "Published just now"; }
    statusPill.className = cls;
    clear(statusPill);
    statusPill.appendChild(dot);
    statusPill.appendChild(document.createTextNode(text));
  }

  function loadDashboard() {
    clear($app);
    $app.appendChild(el("div", { class: "boot", role: "status" }, [
      el("div", { class: "boot-mark" }, "Bayshore"),
      el("p", null, "Loading your content..."),
    ]));
    api("/api/content?state=draft").then(function (r) {
      if (r.status === 401) return renderLogin();
      if (!r.ok || !r.data || typeof r.data !== "object") {
        return showFatal("We loaded the manager but could not read your content. Please refresh to try again.");
      }
      state.content = r.data;
      ensureShape(state.content);
      state.dirty = false;
      // Read the live (published) content so we can tell, on this load,
      // whether the saved draft has changes that are not live yet.
      return api("/api/content?state=published").then(function (pr) {
        if (pr.ok && pr.data && typeof pr.data === "object") {
          var pub = pr.data;
          ensureShape(pub); // normalise shape so the hash compares like for like
          state.publishedHash = contentHash(pub);
          state.publishedKnown = true;
        } else {
          state.publishedKnown = false;
        }
        renderDashboard();
      }).catch(function () {
        // If we cannot read the live copy, fall back to the plain saved state
        // rather than guessing about publish status.
        state.publishedKnown = false;
        renderDashboard();
      });
    }).catch(function () {
      showFatal("We could not load your content. Please check your connection and refresh.");
    });
  }

  // Defensive: make sure expected containers exist so editors never crash.
  function ensureShape(c) {
    c.site = c.site || {};
    c.site.hours = c.site.hours || {};
    if (c.site.inventoryNote == null) c.site.inventoryNote = "";
    c.banner = c.banner || {}; c.banner.items = c.banner.items || [];
    c.hero = c.hero || {}; c.hero.ctaPrimary = c.hero.ctaPrimary || {}; c.hero.ctaSecondary = c.hero.ctaSecondary || {};
    c.stats = Array.isArray(c.stats) ? c.stats : [];
    c.sections = c.sections || {};
    ["apparel", "art", "gifts", "toys"].forEach(function (k) {
      c.sections[k] = c.sections[k] || {};
    });
    ["apparel", "art", "gifts"].forEach(function (k) {
      c.sections[k].cards = c.sections[k].cards || [];
    });
    c.sections.toys.list = Array.isArray(c.sections.toys.list) ? c.sections.toys.list : [];
    // New arrivals: a top-level block with the same card shape as the sections.
    c.newArrivals = c.newArrivals || {};
    if (c.newArrivals.eyebrow == null) c.newArrivals.eyebrow = "";
    if (c.newArrivals.title == null) c.newArrivals.title = "";
    if (c.newArrivals.intro == null) c.newArrivals.intro = "";
    c.newArrivals.items = Array.isArray(c.newArrivals.items) ? c.newArrivals.items : [];
    c.newArrivals.items.forEach(function (it) { if (it && !it.id) it.id = uid("n"); });
    c.about = c.about || {}; c.about.body = Array.isArray(c.about.body) ? c.about.body : [];
    c.visit = c.visit || {};
  }

  // ----- id helper for new list items -----
  function uid(prefix) {
    return (prefix || "n") + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  // ======================================================================
  //  PANEL DEFINITIONS (left nav)
  // ======================================================================
  var PANELS = [
    { id: "site", label: "Site and contact", group: "Basics", render: panelSite },
    { id: "banner", label: "Banner messages", group: "Basics", render: panelBanner },
    { id: "hero", label: "Hero (top of page)", group: "Basics", render: panelHero },
    { id: "stats", label: "Stat highlights", group: "Basics", render: panelStats },
    { id: "newArrivals", label: "New arrivals", group: "Basics", render: panelNewArrivals },
    { id: "apparel", label: "Apparel", group: "Sections", render: function (m) { return panelCardSection(m, "apparel", "Apparel"); } },
    { id: "art", label: "Art and gallery", group: "Sections", render: function (m) { return panelCardSection(m, "art", "Art and gallery"); } },
    { id: "gifts", label: "Gifts and souvenirs", group: "Sections", render: function (m) { return panelCardSection(m, "gifts", "Gifts and souvenirs"); } },
    { id: "toys", label: "Toys and kites", group: "Sections", render: panelToys },
    { id: "about", label: "About", group: "Pages", render: panelAbout },
    { id: "visit", label: "Visit", group: "Pages", render: panelVisit },
  ];

  function renderDashboard() {
    clear($app);

    statusPill = el("span", { class: "status-pill is-saved", role: "status", "aria-live": "polite" });
    if (state.dirty) setStatus("unsaved"); else setSavedStatus();

    var saveBtn = el("button", { class: "btn btn-primary", id: "act-save" }, "Save draft");
    saveBtn.addEventListener("click", saveDraft);

    var previewBtn = el("button", { class: "btn btn-ghost", title: "Saves first if needed, then opens your live site showing the draft" }, "Preview");
    previewBtn.addEventListener("click", openPreview);

    var publishBtn = el("button", { class: "btn btn-publish" }, "Publish");
    publishBtn.addEventListener("click", publish);

    var logoutBtn = el("button", { class: "btn btn-ghost btn-sm" }, "Log out");
    logoutBtn.addEventListener("click", logout);

    var actionbar = el("header", { class: "actionbar" }, [
      el("div", { class: "brand" }, [el("span", null, "Bayshore"), el("span", { class: "hint", style: "color:var(--ink-faint);font-weight:600" }, "Content Manager")]),
      el("div", { class: "actions" }, [statusPill, saveBtn, previewBtn, publishBtn, logoutBtn]),
    ]);

    var nav = buildNav();
    var editorWrap = el("main", { class: "editor", id: "main", tabindex: "-1" });

    var body = el("div", { class: "dash-body" }, [nav, editorWrap]);
    $app.appendChild(el("div", { class: "app-shell" }, [actionbar, body]));

    renderPanel(state.activePanel);

    // Warn before leaving with unsaved changes.
    window.onbeforeunload = function () {
      if (state.dirty) return "You have unsaved changes.";
    };
  }

  function buildNav() {
    var nav = el("nav", { class: "sidenav", "aria-label": "Content sections" });
    var lastGroup = null;
    PANELS.forEach(function (p) {
      if (p.group !== lastGroup) {
        nav.appendChild(el("h2", null, p.group));
        lastGroup = p.group;
      }
      var btn = el("button", {
        class: "nav-btn" + (p.id === state.activePanel ? " is-active" : ""),
        type: "button",
        "data-panel": p.id,
        "aria-current": p.id === state.activePanel ? "true" : null,
        onclick: function () { state.activePanel = p.id; refreshNav(); renderPanel(p.id); },
      }, p.label);
      nav.appendChild(btn);
    });
    return nav;
  }
  function refreshNav() {
    var btns = document.querySelectorAll(".nav-btn");
    Array.prototype.forEach.call(btns, function (b) {
      var on = b.getAttribute("data-panel") === state.activePanel;
      b.classList.toggle("is-active", on);
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
  }
  function renderPanel(id) {
    var def = PANELS.filter(function (p) { return p.id === id; })[0] || PANELS[0];
    var main = document.getElementById("main");
    clear(main);
    try {
      main.appendChild(def.render(main));
    } catch (err) {
      main.appendChild(el("div", { class: "inline-error" }, "Something went wrong drawing this section. Your other content is safe. Please reload."));
    }
    main.scrollTop = 0;
    main.focus();
  }

  // ======================================================================
  //  FIELD BUILDERS (bound to an object property)
  // ======================================================================
  function textField(label, obj, key, opts) {
    opts = opts || {};
    var id = "f_" + Math.random().toString(36).slice(2, 8);
    var input = el(opts.textarea ? "textarea" : "input", {
      id: id,
      type: opts.type || "text",
      value: opts.textarea ? null : (obj[key] != null ? obj[key] : ""),
      placeholder: opts.placeholder || "",
      rows: opts.rows || null,
    });
    if (opts.textarea) input.value = obj[key] != null ? obj[key] : "";
    input.addEventListener("input", function () {
      obj[key] = input.value;
      markDirty();
    });
    return el("div", { class: "field" }, [
      el("label", { for: id }, label),
      input,
      opts.hint ? el("span", { class: "hint" }, opts.hint) : null,
    ]);
  }

  // ----- image field with upload, preview, replace-confirm ----------------
  // kind: optional "logo" | "hero" | "photo" -> drives the guidance line.
  function imageField(label, obj, key, altObj, altKey, kind) {
    kind = kind || "photo";
    var GUIDE = {
      logo: "A small logo file (PNG works best). A square or wide shape, with a see through background if you have one.",
      hero: "A wide landscape photo (JPG). About 1200 pixels wide reads well across the top of the page.",
      photo: "A landscape photo (JPG). About 1200 pixels wide looks crisp on the site.",
    };
    var guideText = GUIDE[kind] || GUIDE.photo;
    var wrap = el("div", { class: "field" });
    wrap.appendChild(el("span", { class: "field-label" }, label));

    var thumb = el("div", { class: "media-thumb" });
    function paintThumb() {
      clear(thumb);
      var src = obj[key];
      if (src) thumb.appendChild(el("img", { src: resolveImg(src), alt: "Current image preview" }));
      else thumb.appendChild(el("span", null, "No image yet"));
    }
    paintThumb();

    var fileInput = el("input", { type: "file", accept: "image/*", class: "visually-hidden" });
    var uploadBtn = el("button", { class: "btn btn-sm btn-ghost", type: "button" }, obj[key] ? "Replace photo" : "Upload photo");
    var busy = el("span", { class: "media-busy", hidden: true }, "Uploading...");
    var pathLine = el("p", { class: "media-path" }, obj[key] ? obj[key] : "No image set");

    uploadBtn.addEventListener("click", function () {
      if (obj[key]) {
        confirmDialog({
          title: "Replace this photo?",
          message: "The current photo will be swapped for the new one when you save. This cannot be undone after you publish.",
          confirmLabel: "Choose new photo",
        }).then(function (ok) { if (ok) fileInput.click(); });
      } else {
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) {
        toast("That image is over 6 MB, which is too large to upload. Please use a smaller file.", "error");
        fileInput.value = "";
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        // Warn, do not block: the server accepts up to 6 MB, but big files are
        // slow and usually larger than the site needs.
        toast("That image is fairly large. It will still upload, but a smaller photo (under about 2 MB) loads faster.", "warn");
      }
      busy.hidden = false; uploadBtn.disabled = true;
      var reader = new FileReader();
      reader.onerror = function () {
        busy.hidden = true; uploadBtn.disabled = false;
        toast("We could not read that file. Please try another image.", "error");
      };
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var base64 = dataUrl.indexOf(",") >= 0 ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl;
        api("/api/media", {
          method: "POST",
          body: { filename: file.name, contentType: file.type || "image/jpeg", dataBase64: base64 },
        }).then(function (r) {
          busy.hidden = true; uploadBtn.disabled = false; fileInput.value = "";
          if (r.ok && r.data && r.data.url) {
            obj[key] = r.data.url;
            markDirty();
            paintThumb();
            pathLine.textContent = obj[key];
            uploadBtn.textContent = "Replace photo";
            toast("Photo uploaded. Remember to save your draft.", "success");
          } else {
            toast((r.data && r.data.error) ? r.data.error : "Upload failed. Please try again.", "error");
          }
        }).catch(function () {
          busy.hidden = true; uploadBtn.disabled = false; fileInput.value = "";
          toast("We could not reach the server. Please try the upload again.", "error");
        });
      };
      reader.readAsDataURL(file);
    });

    var controls = el("div", { class: "media-controls" }, [
      el("div", { class: "media-actions" }, [uploadBtn, busy]),
      pathLine,
      el("p", { class: "guide" }, "Recommended: " + guideText),
    ]);

    wrap.appendChild(el("div", { class: "media-field" }, [thumb, controls]));
    fileInput.style.position = "absolute";
    wrap.appendChild(fileInput);

    if (altObj && altKey != null) {
      wrap.appendChild(textField("Photo description (for screen readers and SEO)", altObj, altKey, {
        hint: "Describe what the photo shows in a few plain words.",
      }));
    }
    return wrap;
  }

  // Public pages reference draft images by their stored path; uploaded media
  // come back as /api/media?key=... Seed paths are site-relative (assets/...).
  function resolveImg(src) {
    if (!src) return "";
    if (/^https?:\/\//.test(src) || src.indexOf("/api/media") === 0 || src.charAt(0) === "/") return src;
    return "/" + src; // assets/img/... -> /assets/img/...
  }

  // ======================================================================
  //  LIST EDITOR (add / remove / reorder) used by many panels
  // ======================================================================
  // items: array on the content. makeRow(item, index) -> DOM for the body.
  // newItem() -> a fresh object. titleOf(item) -> short label.
  function listEditor(opts) {
    var items = opts.items;
    var container = el("div", { class: "list" });

    function rerender() { renderRows(); }
    function renderRows() {
      clear(container);
      if (!items.length) {
        container.appendChild(el("p", { class: "hint" }, opts.emptyText || "Nothing here yet. Use the button below to add the first one."));
      }
      items.forEach(function (item, i) {
        var up = el("button", { class: "icon-btn", type: "button", title: "Move up", "aria-label": "Move up" }, "↑");
        var down = el("button", { class: "icon-btn", type: "button", title: "Move down", "aria-label": "Move down" }, "↓");
        var del = el("button", { class: "icon-btn", type: "button", title: "Remove", "aria-label": "Remove" }, "×");
        up.disabled = i === 0;
        down.disabled = i === items.length - 1;
        up.addEventListener("click", function () { swap(i, i - 1); });
        down.addEventListener("click", function () { swap(i, i + 1); });
        del.addEventListener("click", function () {
          confirmDialog({
            title: "Remove this item?",
            message: opts.deleteMsg || "This will remove it from your website when you publish. You cannot undo this.",
            danger: true,
            confirmLabel: "Remove",
          }).then(function (ok) {
            if (!ok) return;
            items.splice(i, 1);
            markDirty();
            renderRows();
          });
        });
        var head = el("div", { class: "item-head" }, [
          el("span", { class: "item-title" }, (opts.titleOf ? opts.titleOf(item, i) : ("Item " + (i + 1)))),
          el("div", { class: "item-tools" }, [up, down, del]),
        ]);
        var card = el("div", { class: "item-card" }, [head, opts.makeRow(item, i)]);
        container.appendChild(card);
      });
    }
    function swap(a, b) {
      if (b < 0 || b >= items.length) return;
      var t = items[a]; items[a] = items[b]; items[b] = t;
      markDirty();
      renderRows();
    }
    renderRows();

    var addBtn = el("button", { class: "btn btn-ghost add-row", type: "button" }, opts.addLabel || "Add item");
    addBtn.addEventListener("click", function () {
      items.push(opts.newItem());
      markDirty();
      renderRows();
      // focus the first input of the new card
      var last = container.lastChild;
      if (last) { var inp = last.querySelector("input, textarea"); if (inp) inp.focus(); }
    });

    return el("div", null, [container, addBtn]);
  }

  function panelShell(title, desc, children) {
    return el("div", null, [
      el("div", { class: "panel-head" }, [el("h1", null, title), desc ? el("p", null, desc) : null]),
      children,
    ]);
  }

  // ======================================================================
  //  PANEL: SITE AND CONTACT
  // ======================================================================
  function panelSite() {
    var s = state.content.site;
    var h = s.hours;
    return panelShell("Site and contact", "The shop name, contact details, hours, and social links that appear across the site.", el("div", null, [
      el("div", { class: "grid-2" }, [
        textField("Shop name", s, "shop"),
        textField("Short name", s, "shortName"),
      ]),
      textField("Tagline", s, "tagline", { hint: "The short line under the shop name." }),
      textField("Blurb", s, "blurb", { textarea: true, rows: 3, hint: "A sentence or two describing the shop." }),
      textField("Inventory note", s, "inventoryNote", { textarea: true, rows: 2, hint: "Shown as a small note under the product photos, for example that stock rotates and the exact items may change." }),
      el("div", { class: "grid-2" }, [
        textField("Phone (shown)", s, "phone"),
        textField("Phone (for tap to call)", s, "phoneHref", { hint: "Digits only, like +15418080980." }),
      ]),
      textField("Email", s, "email", { type: "email" }),
      el("div", { class: "subhead" }, "Address"),
      textField("Address line 1", s, "addressLine1"),
      textField("Address line 2", s, "addressLine2"),
      textField("Full address (one line)", s, "address", { hint: "Used in some links and listings." }),
      el("div", { class: "subhead" }, "Hours"),
      textField("Hours text (shown on the site)", s, "hoursText", { hint: "Plain words, like: Open daily, 11:00 am to 5:00 pm." }),
      textField("Hours short", s, "hoursShort"),
      el("div", { class: "grid-2" }, [
        textField("Opens at", h, "open", { type: "time", hint: "24 hour time, like 11:00." }),
        textField("Closes at", h, "close", { type: "time", hint: "24 hour time, like 17:00." }),
      ]),
      textField("Days open", h, "days", { hint: "For example: daily, or Tue to Sun." }),
      el("div", { class: "subhead" }, "Social and map"),
      textField("Facebook link", s, "facebook", { type: "url" }),
      textField("Instagram link", s, "instagram", { type: "url" }),
      textField("Map embed link", s, "mapEmbed", { type: "url", hint: "The Google Maps embed link for the map box." }),
      textField("Map link (opens directions)", s, "mapLink", { type: "url" }),
      el("div", { class: "subhead" }, "Logo"),
      imageField("Logo image", s, "logo", null, null, "logo"),
    ]));
  }

  // ======================================================================
  //  PANEL: BANNER MESSAGES
  // ======================================================================
  function panelBanner() {
    var items = state.content.banner.items;
    return panelShell("Banner messages", "The short messages that scroll across the top strip of the site. Keep each one a few words.", listEditor({
      items: items,
      addLabel: "Add a message",
      emptyText: "No messages yet. Add your first banner message.",
      titleOf: function (it) { return it.text || "New message"; },
      newItem: function () { return { id: uid("b"), text: "" }; },
      makeRow: function (it) { return textField("Message", it, "text", { hint: "A few words, like: Locally owned." }); },
    }));
  }

  // ======================================================================
  //  PANEL: HERO
  // ======================================================================
  function panelHero() {
    var h = state.content.hero;
    return panelShell("Hero (top of page)", "The big opening area at the top of the home page.", el("div", null, [
      textField("Eyebrow (small line above the title)", h, "eyebrow"),
      textField("Title", h, "title"),
      textField("Lead paragraph", h, "lead", { textarea: true, rows: 4 }),
      imageField("Hero photo", h, "image", h, "alt", "hero"),
      el("div", { class: "subhead" }, "Primary button"),
      el("div", { class: "grid-2" }, [
        textField("Button label", h.ctaPrimary, "label"),
        textField("Button link", h.ctaPrimary, "href", { hint: "A page like apparel.html or a full web link." }),
      ]),
      el("div", { class: "subhead" }, "Secondary button"),
      el("div", { class: "grid-2" }, [
        textField("Button label", h.ctaSecondary, "label"),
        textField("Button link", h.ctaSecondary, "href"),
      ]),
    ]));
  }

  // ======================================================================
  //  PANEL: STATS
  // ======================================================================
  function panelStats() {
    var items = state.content.stats;
    return panelShell("Stat highlights", "The short value and label pairs shown as highlights, like Local Oregon artists.", listEditor({
      items: items,
      addLabel: "Add a highlight",
      titleOf: function (it) { return (it.value || "New") + " " + (it.label || ""); },
      newItem: function () { return { id: uid("s"), value: "", label: "" }; },
      makeRow: function (it) {
        return el("div", { class: "grid-2" }, [
          textField("Value", it, "value", { hint: "For example: Local or Daily." }),
          textField("Label", it, "label", { hint: "For example: Oregon artists and small makers." }),
        ]);
      },
    }));
  }

  // ======================================================================
  //  PANEL: GENERIC CARD SECTION (apparel, art, gifts)
  // ======================================================================
  function panelCardSection(mount, key, title) {
    var sec = state.content.sections[key];
    sec.cards = sec.cards || [];
    return panelShell(title, "Edit the section heading and its cards. Each card has a small kicker, a title, a short line, and a photo.", el("div", null, [
      textField("Number", sec, "num", { hint: "The small section number, like 01." }),
      textField("Eyebrow", sec, "eyebrow"),
      textField("Title", sec, "title"),
      textField("Lead paragraph", sec, "lead", { textarea: true, rows: 3 }),
      el("div", { class: "subhead" }, "Cards"),
      listEditor({
        items: sec.cards,
        addLabel: "Add a card",
        titleOf: function (it) { return it.title || it.kicker || "New card"; },
        newItem: function () { return { id: uid("c"), kicker: "", title: "", body: "", image: "", alt: "" }; },
        makeRow: function (it) {
          return el("div", null, [
            el("div", { class: "grid-2" }, [
              textField("Kicker (small label)", it, "kicker"),
              textField("Title", it, "title"),
            ]),
            textField("Short line", it, "body", { textarea: true, rows: 2 }),
            imageField("Card photo", it, "image", it, "alt"),
          ]);
        },
      }),
    ]));
  }

  // ======================================================================
  //  PANEL: NEW ARRIVALS (top-level block, same card shape as the sections)
  // ======================================================================
  function panelNewArrivals() {
    var na = state.content.newArrivals;
    na.items = Array.isArray(na.items) ? na.items : [];
    return panelShell("New arrivals", "The few new items shown on the home page. Add, edit, remove, or reorder freely.", el("div", null, [
      textField("Eyebrow", na, "eyebrow"),
      textField("Title", na, "title"),
      textField("Intro paragraph", na, "intro", { textarea: true, rows: 3 }),
      el("div", { class: "subhead" }, "Items"),
      listEditor({
        items: na.items,
        addLabel: "Add an item",
        titleOf: function (it) { return it.title || it.kicker || "New item"; },
        newItem: function () { return { id: uid("n"), kicker: "", title: "", body: "", image: "", alt: "" }; },
        makeRow: function (it) {
          return el("div", null, [
            el("div", { class: "grid-2" }, [
              textField("Kicker (small label)", it, "kicker"),
              textField("Title", it, "title"),
            ]),
            textField("Short line", it, "body", { textarea: true, rows: 2 }),
            imageField("Item photo", it, "image", it, "alt"),
          ]);
        },
      }),
    ]));
  }

  // ======================================================================
  //  PANEL: TOYS AND KITES (single feature: body + bullet list + one photo)
  // ======================================================================
  function panelToys() {
    var sec = state.content.sections.toys;
    sec.list = Array.isArray(sec.list) ? sec.list : [];
    // The list is an array of plain strings. Wrap each in a small object so the
    // shared list editor can bind to it, then sync back to plain strings.
    var bulletObjs = sec.list.map(function (t) { return { text: t }; });
    function syncList() { sec.list = bulletObjs.map(function (b) { return b.text; }); markDirty(); }

    var bulletsEditor = listEditor({
      items: bulletObjs,
      addLabel: "Add a bullet point",
      titleOf: function (it, i) { return it.text || ("Bullet " + (i + 1)); },
      newItem: function () { return { text: "" }; },
      deleteMsg: "This removes the bullet point from your Toys and kites section when you publish.",
      makeRow: function (it) {
        var id = "t_" + Math.random().toString(36).slice(2, 8);
        var input = el("input", { id: id, type: "text" });
        input.value = it.text || "";
        input.addEventListener("input", function () { it.text = input.value; syncList(); });
        return el("div", { class: "field" }, [el("label", { for: id }, "Bullet point"), input]);
      },
    });

    return panelShell("Toys and kites", "The toys, kites, and kids section. It has a write up, a short list of bullet points, and one photo.", el("div", null, [
      textField("Eyebrow", sec, "eyebrow"),
      textField("Title", sec, "title"),
      textField("Body", sec, "body", { textarea: true, rows: 4 }),
      el("div", { class: "subhead" }, "Bullet points"),
      bulletsEditor,
      el("div", { class: "subhead" }, "Photo"),
      imageField("Photo", sec, "image", sec, "alt"),
    ]));
  }

  // ======================================================================
  //  PANEL: ABOUT
  // ======================================================================
  function panelAbout() {
    var a = state.content.about;
    a.body = Array.isArray(a.body) ? a.body : [];
    // Body is an array of strings. Wrap each in a small object for the editor.
    var paraObjs = a.body.map(function (t) { return { text: t }; });

    function syncBody() { a.body = paraObjs.map(function (p) { return p.text; }); markDirty(); }

    var paragraphsEditor = listEditor({
      items: paraObjs,
      addLabel: "Add a paragraph",
      titleOf: function (it, i) { return "Paragraph " + (i + 1); },
      newItem: function () { return { text: "" }; },
      deleteMsg: "This removes the paragraph from your About page when you publish.",
      makeRow: function (it) {
        var id = "p_" + Math.random().toString(36).slice(2, 8);
        var ta = el("textarea", { id: id, rows: "3" });
        ta.value = it.text || "";
        ta.addEventListener("input", function () { it.text = ta.value; syncBody(); });
        return el("div", { class: "field" }, [el("label", { for: id }, "Paragraph"), ta]);
      },
    });

    return panelShell("About", "The story section on your About page.", el("div", null, [
      textField("Eyebrow", a, "eyebrow"),
      textField("Title", a, "title"),
      textField("Lead paragraph", a, "lead", { textarea: true, rows: 3 }),
      el("div", { class: "subhead" }, "Body paragraphs"),
      paragraphsEditor,
      el("div", { class: "subhead" }, "Photo"),
      imageField("About photo", a, "image", a, "alt"),
    ]));
  }

  // ======================================================================
  //  PANEL: VISIT
  // ======================================================================
  function panelVisit() {
    var v = state.content.visit;
    return panelShell("Visit", "The visit section with directions and a note.", el("div", null, [
      textField("Eyebrow", v, "eyebrow"),
      textField("Title", v, "title"),
      textField("Lead paragraph", v, "lead", { textarea: true, rows: 4 }),
      textField("Note", v, "note", { textarea: true, rows: 2, hint: "A short extra line, like a tip for visitors." }),
    ]));
  }

  // ======================================================================
  //  ACTIONS: SAVE / PUBLISH / LOGOUT
  // ======================================================================
  // onSaved: optional callback run only after a successful save (used by Preview
  // so the previewed page reflects the on-screen edits, not a stale draft).
  function saveDraft(onSaved) {
    if (state.saving) return;
    state.saving = true;
    var btn = document.getElementById("act-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
    api("/api/content", { method: "PUT", body: state.content }).then(function (r) {
      state.saving = false;
      if (btn) { btn.disabled = false; btn.textContent = "Save draft"; }
      if (r.status === 401) { toast("Your session ended. Please sign in again.", "error"); return renderLogin(); }
      if (r.ok && r.data && r.data.ok) {
        state.dirty = false;
        setSavedStatus();
        toast("Draft saved. Use Preview to see it, or Publish to make it live.", "success");
        if (typeof onSaved === "function") onSaved();
      } else {
        toast((r.data && r.data.error) ? r.data.error : "Save failed. Please try again.", "error");
      }
    }).catch(function () {
      state.saving = false;
      if (btn) { btn.disabled = false; btn.textContent = "Save draft"; }
      toast("We could not reach the server. Your changes are still here. Please try saving again.", "error");
    });
  }

  // Open the live site in preview mode (shows the saved draft). If there are
  // unsaved edits, save them first so the preview is not stale, then open the
  // tab once the save succeeds.
  function openPreview() {
    function openTab() {
      var w = window.open("/?preview=1", "_blank", "noopener");
      // Some browsers block a window opened from inside an async callback.
      if (!w) toast("Your changes are saved. Your browser blocked the preview tab, so please use the Preview button once more to open it.", "warn");
    }
    if (state.dirty) {
      if (state.saving) return; // a save is already running; avoid double work
      toast("Saving your changes so the preview is up to date...", "success");
      saveDraft(openTab);
    } else {
      openTab();
    }
  }

  function publish() {
    var doPublish = function () {
      api("/api/publish", { method: "POST" }).then(function (r) {
        if (r.status === 401) { toast("Your session ended. Please sign in again.", "error"); return renderLogin(); }
        if (r.ok && r.data && r.data.ok) {
          // The live site now matches what is on screen / last saved.
          state.publishedHash = contentHash(state.content);
          state.publishedKnown = true;
          setStatus("published");
          toast("Your website is now live with these changes.", "success");
        } else {
          toast((r.data && r.data.error) ? r.data.error : "Publish failed. Please try again.", "error");
        }
      }).catch(function () {
        toast("We could not reach the server. Please try publishing again.", "error");
      });
    };

    var message = state.dirty
      ? "You have unsaved changes. They will be saved first, then your live website will be updated for everyone to see."
      : "Your saved draft will go live and replace what visitors see now.";

    confirmDialog({
      title: "Publish to your live website?",
      message: message,
      confirmLabel: "Publish now",
    }).then(function (ok) {
      if (!ok) return;
      if (state.dirty) {
        // Save first, then publish.
        api("/api/content", { method: "PUT", body: state.content }).then(function (r) {
          if (r.status === 401) { toast("Your session ended. Please sign in again.", "error"); return renderLogin(); }
          if (r.ok && r.data && r.data.ok) {
            state.dirty = false; setStatus("saved");
            doPublish();
          } else {
            toast("We could not save before publishing. Please try Save draft first.", "error");
          }
        }).catch(function () {
          toast("We could not reach the server to save. Please try again.", "error");
        });
      } else {
        doPublish();
      }
    });
  }

  function logout() {
    var go = function () {
      window.onbeforeunload = null;
      api("/api/logout", { method: "POST" }).then(function () { renderLogin(); }).catch(function () { renderLogin(); });
    };
    if (state.dirty) {
      confirmDialog({
        title: "Log out with unsaved changes?",
        message: "You have changes that are not saved. If you log out now they will be lost.",
        danger: true,
        confirmLabel: "Log out anyway",
      }).then(function (ok) { if (ok) go(); });
    } else {
      go();
    }
  }

  // go
  boot();
})();
