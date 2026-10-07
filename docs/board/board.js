/* HEISS UI feedback board: three columns of posts, upvotes, comments, and an admin mode to arrange them. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const API = "/api/board/";

  const TYPES = ["bug", "idea", "question"];
  const TYPE_NAME = { bug: "Bug", idea: "Idea", question: "Question" };
  const STATUS = [
    ["open", "Open"],
    ["planned", "Planned"],
    ["progress", "In progress"],
    ["done", "Done"],
    ["closed", "Closed"],
  ];
  const STATUS_NAME = Object.fromEntries(STATUS);
  const ACTIVE = new Set(["open", "planned", "progress"]);
  const KIND = {
    bug: { hint: "Something that doesn’t work the way it should.", title: "What goes wrong, in a few words", body: "What did you do, what happened, and what did you expect? An error message helps a lot." },
    idea: { hint: "Something HEISS UI could do, or do better.", title: "Short and specific", body: "What would it look like, and when would you use it?" },
    question: { hint: "Not sure how something works? Ask.", title: "Your question", body: "What are you trying to do?" },
  };

  const state = {
    cards: [],
    voted: new Set(),
    admin: false,
    loaded: false,
    sort: read("hb-sort") || "board",
    query: "",
    tab: "bug",
    doneOpen: {},
    fresh: "",
  };

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function write(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
  }

  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Server ────────────────────────────────────────────────────────── */

  async function api(body, query = "") {
    const response = await fetch(API + query, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "Couldn’t reach the board.");
      error.status = response.status;
      error.ready = data.ready;
      throw error;
    }
    return data;
  }

  /* ── Small helpers ─────────────────────────────────────────────────── */

  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "style") node.style.cssText = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) node.append(child);
    return node;
  }

  function icon(name, cls = "icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", cls);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function ago(time) {
    const s = Math.max(0, (Date.now() - time) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const hr = Math.floor(m / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.max(1, Math.floor(d / 30.4));
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(d / 365)}y ago`;
  }

  const fullDate = (time) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  let toastTimer;
  function toast(text) {
    const node = $("[data-toast]");
    node.textContent = text;
    node.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-on"), 2600);
  }

  const statusChip = (card) => {
    const label = card.status === "done" && card.release ? `Shipped in ${card.release}` : STATUS_NAME[card.status] || "Open";
    return h("i", { class: `b-status is-${card.status}`, text: label });
  };

  const initial = (name) => (name || "?").trim().charAt(0).toUpperCase() || "?";

  /* ── Sorting and search ────────────────────────────────────────────── */

  const words = (text) =>
    String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2);

  const matches = (card) => {
    if (!state.query) return true;
    const hay = `${card.title} ${card.body} ${card.name} ${card.release}`.toLowerCase();
    return state.query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => hay.includes(term));
  };

  const byVotes = (a, b) => b.votes - a.votes || b.createdAt - a.createdAt;
  const sorters = {
    board: (a, b) => {
      const pa = a.pos ?? Infinity;
      const pb = b.pos ?? Infinity;
      return pa !== pb ? pa - pb : byVotes(a, b);
    },
    top: byVotes,
    new: (a, b) => b.createdAt - a.createdAt,
  };

  function columns() {
    const out = {};
    for (const type of TYPES) {
      const mine = state.cards.filter((card) => card.type === type);
      out[type] = {
        active: mine.filter((card) => ACTIVE.has(card.status) && matches(card)).sort(sorters[state.sort] || sorters.board),
        done: mine.filter((card) => !ACTIVE.has(card.status) && matches(card)).sort((a, b) => b.statusAt - a.statusAt),
        total: mine.filter((card) => ACTIVE.has(card.status)).length,
      };
    }
    return out;
  }

  /* ── Board ─────────────────────────────────────────────────────────── */

  function voteButton(card, size = "") {
    const on = state.voted.has(card.id);
    const button = h(
      "button",
      {
        class: `b-vote ${size}`,
        type: "button",
        "aria-pressed": String(on),
        "aria-label": `${on ? "Remove your upvote" : "Upvote"}: ${card.votes} vote${card.votes === 1 ? "" : "s"}`,
        onclick: (event) => {
          event.stopPropagation();
          toggleVote(card.id, button);
        },
      },
      icon("up"),
      h("span", { text: String(card.votes) })
    );
    return button;
  }

  function cardNode(card, index, draggable) {
    const tags = h("div", { class: "b-card-tags" }, statusChip(card));
    if (card.source === "app") tags.append(h("span", { class: "b-tag", title: `Sent from the app${card.appVersion ? ` (v${card.appVersion})` : ""}` }, icon("app"), "App"));

    const meta = h(
      "div",
      { class: "b-meta" },
      h("span", { class: "b-avatar", "aria-hidden": "true", text: initial(card.name || "A") }),
      h("span", { class: "b-who", text: card.name || "Anonymous" }),
      h("span", { class: "b-when", title: fullDate(card.createdAt), text: ago(card.createdAt) }),
      h("span", { class: "b-meta-end" }, h("span", { class: "b-meta-item", "aria-label": `${card.comments} comments` }, icon("comment"), String(card.comments)))
    );

    const node = h(
      "article",
      {
        class: `b-card is-${card.status}${state.fresh === card.id ? " is-new" : ""}`,
        "data-id": card.id,
        style: `--k: ${Math.min(index, 12)}`,
        draggable: draggable ? "true" : null,
      },
      h("span", { class: "b-drag", "aria-hidden": "true" }, icon("grip")),
      h("div", { class: "b-card-top" }, tags, voteButton(card)),
      h("button", { class: "b-card-open", type: "button", text: card.title, onclick: () => openDetail(card.id) }),
      card.body ? h("p", { class: "b-card-text", text: card.body }) : null,
      meta
    );
    if (draggable) wireDrag(node);
    return node;
  }

  function emptyNode(type) {
    const text = state.query
      ? "Nothing matches that search here."
      : { bug: "No open bugs. Found one?", idea: "No ideas yet. Got one?", question: "No open questions." }[type];
    return h(
      "div",
      { class: "b-empty" },
      h("span", { class: "b-empty-tile", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")),
      h("span", { text }),
      state.query ? null : h("button", { type: "button", text: { bug: "Report a bug", idea: "Share an idea", question: "Ask a question" }[type], onclick: () => openCompose(type) })
    );
  }

  function render() {
    const cols = columns();
    const board = $("[data-board]");
    board.setAttribute("aria-busy", "false");
    document.body.classList.toggle("is-admin", state.admin);
    $("[data-adminbar]").hidden = !state.admin;

    for (const type of TYPES) {
      const { active, done, total } = cols[type];
      $$(`[data-count="${type}"]`).forEach((node) => (node.textContent = state.loaded ? String(total) : ""));

      const list = $(`[data-list="${type}"]`);
      list.replaceChildren(...(active.length ? active.map((card, i) => cardNode(card, i, state.admin)) : [emptyNode(type)]));

      const doneBox = $(`[data-done="${type}"]`);
      if (!done.length) {
        doneBox.replaceChildren();
        continue;
      }
      const open = Boolean(state.doneOpen[type] || state.query);
      const shipped = done.filter((card) => card.status === "done").length;
      const label = shipped === done.length ? `Done (${done.length})` : `Done and closed (${done.length})`;
      const listId = `done-${type}`;
      doneBox.replaceChildren(
        h(
          "button",
          {
            class: "b-done-toggle",
            type: "button",
            "aria-expanded": String(open),
            "aria-controls": listId,
            onclick: () => {
              state.doneOpen[type] = !state.doneOpen[type];
              render();
            },
          },
          open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`,
          icon("chev")
        ),
        h("div", { class: "b-done-list", id: listId, hidden: !open }, ...(open ? done.map((card, i) => cardNode(card, i, false)) : []))
      );
    }
    syncTabs();
    state.fresh = "";
  }

  function skeleton() {
    for (const type of TYPES) $(`[data-list="${type}"]`).replaceChildren(h("div", { class: "b-skel" }), h("div", { class: "b-skel" }), h("div", { class: "b-skel" }));
  }

  async function load() {
    try {
      const data = await api(null);
      state.cards = data.cards || [];
      state.voted = new Set(data.voted || []);
      state.admin = Boolean(data.admin);
      state.loaded = true;
      $("[data-offline]").hidden = true;
      $("[data-board]").hidden = false;
      render();
      return true;
    } catch (error) {
      const offline = $("[data-offline]");
      $(".b-offline-title", offline).textContent = error.ready === false ? "The board is almost ready." : "The board isn’t reachable right now.";
      $("p:nth-of-type(2)", offline).textContent =
        error.ready === false ? "It opens as soon as its storage is connected. Until then, GitHub issues work the same." : "Posts are safe. Try again in a moment, or open an issue on GitHub in the meantime.";
      offline.hidden = false;
      $("[data-board]").hidden = true;
      $("[data-tabs]").hidden = true;
      return false;
    }
  }

  /* ── Votes ─────────────────────────────────────────────────────────── */

  async function toggleVote(id, button) {
    const card = state.cards.find((item) => item.id === id);
    if (!card) return;
    const on = !state.voted.has(id);
    const apply = (value, votes) => {
      if (value) state.voted.add(id);
      else state.voted.delete(id);
      card.votes = votes;
      $$(`.b-card[data-id="${id}"] .b-vote, [data-detail] .b-vote[data-for="${id}"]`).forEach((node) => {
        node.setAttribute("aria-pressed", String(value));
        node.setAttribute("aria-label", `${value ? "Remove your upvote" : "Upvote"}: ${votes} vote${votes === 1 ? "" : "s"}`);
        $("span", node).textContent = String(votes);
      });
    };
    const before = card.votes;
    apply(on, Math.max(0, before + (on ? 1 : -1)));
    if (on && button && !reduced()) {
      button.classList.remove("pop");
      void button.offsetWidth;
      button.classList.add("pop");
    }
    try {
      const data = await api({ action: "vote", id, on });
      apply(on, data.votes);
    } catch (error) {
      apply(!on, before);
      toast(error.message);
    }
  }

  /* ── New post ──────────────────────────────────────────────────────── */

  const compose = $("[data-compose]");
  const form = $("[data-compose-form]");
  let kind = "idea";

  function setKind(next) {
    kind = TYPES.includes(next) ? next : "idea";
    const seg = $("[data-kind]");
    const buttons = $$("button", seg);
    buttons.forEach((button, i) => {
      const on = button.dataset.value === kind;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
      if (on) seg.style.setProperty("--i", i);
    });
    $("[data-kind-hint]").textContent = KIND[kind].hint;
    $("[data-title]").placeholder = KIND[kind].title;
    $("[data-body]").placeholder = KIND[kind].body;
    const setup = $("[data-setup-wrap]");
    setup.hidden = kind === "question";
    if (kind === "bug") setup.open = true;
    $("[data-submit]").textContent = kind === "bug" ? "Report bug" : kind === "question" ? "Ask" : "Post idea";
  }

  $$("[data-kind] button").forEach((button, i, all) => {
    button.addEventListener("click", () => setKind(button.dataset.value));
    button.addEventListener("keydown", (event) => {
      const dir = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      event.preventDefault();
      const next = all[(i + dir + all.length) % all.length];
      setKind(next.dataset.value);
      next.focus();
    });
  });

  function openCompose(type = "idea", prefill = {}) {
    form.reset();
    $("[data-compose-error]").hidden = true;
    $("[data-similar]").hidden = true;
    $("[data-name]").value = read("hb-name") || "";
    if (prefill.title) $("[data-title]").value = prefill.title;
    if (prefill.body) $("[data-body]").value = prefill.body;
    if (prefill.setup) $("[data-setup]").value = prefill.setup;
    setKind(type);
    if (prefill.setup) $("[data-setup-wrap]").open = true;
    compose.showModal();
    $("[data-title]").focus();
    if (prefill.title) similar();
  }

  function similar() {
    const mine = words($("[data-title]").value);
    const box = $("[data-similar]");
    if (mine.length < 2) {
      box.hidden = true;
      return;
    }
    const scored = state.cards
      .map((card) => {
        const theirs = new Set(words(`${card.title} ${card.title} ${card.body.slice(0, 200)}`));
        const hits = mine.filter((word) => theirs.has(word) || [...theirs].some((other) => other.length > 4 && word.length > 4 && (other.startsWith(word) || word.startsWith(other)))).length;
        return { card, score: hits / mine.length };
      })
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score || b.card.votes - a.card.votes)
      .slice(0, 3);
    box.hidden = !scored.length;
    $("[data-similar-list]").replaceChildren(
      ...scored.map(({ card }) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              onclick: () => {
                compose.close();
                openDetail(card.id);
              },
            },
            h("span", { text: card.title }),
            statusChip(card),
            h("span", { class: "b-similar-votes", text: `▲ ${card.votes}` })
          )
        )
      )
    );
  }
  let similarTimer;
  $("[data-title]").addEventListener("input", () => {
    clearTimeout(similarTimer);
    similarTimer = setTimeout(similar, 160);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("[data-compose-error]");
    const title = $("[data-title]").value.trim();
    if (title.length < 4) {
      error.textContent = "Give it a title of a few words.";
      error.hidden = false;
      $("[data-title]").focus();
      return;
    }
    const submit = $("[data-submit]");
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Posting…";
    error.hidden = true;
    const name = $("[data-name]").value.trim();
    write("hb-name", name);
    try {
      const data = await api({
        action: "create",
        type: kind,
        title,
        body: $("[data-body]").value,
        setup: kind === "question" ? "" : $("[data-setup]").value,
        name,
        website: form.elements.website.value,
        source: "web",
      });
      compose.close();
      if (data.card) {
        state.cards.push(data.card);
        if (data.card.votes) state.voted.add(data.card.id);
        state.fresh = data.card.id;
        state.query = "";
        $("[data-search]").value = "";
        state.tab = data.card.type;
        render();
        const node = $(`.b-card[data-id="${data.card.id}"]`);
        node?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      }
      toast(kind === "bug" ? "Reported. Thank you!" : kind === "question" ? "Asked. Answers show up on the post." : "Posted. Thank you!");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  /* ── One post ──────────────────────────────────────────────────────── */

  const detail = $("[data-detail]");
  const detailBody = $("[data-detail-body]");
  let openId = "";
  let comments = [];
  let commentsLoaded = false;
  let detailLinks = {};

  function segmented(label, options, value, onPick, cls = "") {
    const index = Math.max(0, options.findIndex(([key]) => key === value));
    return h(
      "div",
      { class: `b-seg ${cls}`, role: "radiogroup", "aria-label": label, style: `--i: ${index}` },
      h("span", { class: "b-seg-thumb", "aria-hidden": "true" }),
      ...options.map(([key, name]) => h("button", { type: "button", role: "radio", "aria-checked": String(key === value), "data-value": key, text: name, onclick: () => key !== value && onPick(key) }))
    );
  }

  async function adminUpdate(id, patch, note) {
    try {
      const data = await api({ action: "update", id, patch });
      const index = state.cards.findIndex((card) => card.id === id);
      if (index >= 0) state.cards[index] = { ...state.cards[index], ...data.card };
      render();
      if (openId === id) renderDetail();
      if (note) toast(note);
    } catch (error) {
      toast(error.message);
    }
  }

  function adminPanel(card) {
    let armed = false;
    const del = h("button", {
      class: "b-btn is-danger is-small",
      type: "button",
      text: "Delete",
      onclick: async () => {
        if (!armed) {
          armed = true;
          del.classList.add("is-armed");
          del.textContent = "Delete for good?";
          setTimeout(() => {
            armed = false;
            del.classList.remove("is-armed");
            del.textContent = "Delete";
          }, 3000);
          return;
        }
        try {
          await api({ action: "delete", id: card.id });
          state.cards = state.cards.filter((item) => item.id !== card.id);
          detail.close();
          render();
          toast("Deleted.");
        } catch (error) {
          toast(error.message);
        }
      },
    });

    const release = h("input", { class: "b-input", value: card.release || "", placeholder: "v0.15.0", maxlength: "24", "aria-label": "Shipped in version" });
    release.addEventListener("change", () => adminUpdate(card.id, { release: release.value }, release.value ? `Marked as shipped in ${release.value.trim()}.` : "Version cleared."));

    return h(
      "section",
      { class: "d-admin", "aria-label": "Admin" },
      h("div", { class: "d-admin-row" }, h("span", { text: "Status" }), segmented("Status", STATUS, card.status, (status) => adminUpdate(card.id, { status }, `Moved to ${STATUS_NAME[status]}.`))),
      h(
        "div",
        { class: "d-admin-row" },
        h("span", { text: "Column" }),
        segmented(
          "Column",
          TYPES.map((type) => [type, TYPE_NAME[type]]),
          card.type,
          (type) => adminUpdate(card.id, { type }, `Moved to ${TYPE_NAME[type]}s.`),
          "is-3"
        )
      ),
      card.status === "done" ? h("label", { class: "d-admin-row" }, h("span", { text: "Shipped in (optional)" }), release) : null,
      h("div", { class: "d-admin-actions" }, h("button", { class: "b-btn is-small", type: "button", text: "Edit text", onclick: () => renderDetail({ editing: true }) }), del)
    );
  }

  function editPanel(card) {
    const title = h("input", { class: "b-input", value: card.title, maxlength: "120", "aria-label": "Title" });
    const body = h("textarea", { class: "b-input", rows: "6", maxlength: "4000", "aria-label": "Details" });
    body.value = card.body || "";
    return h(
      "div",
      { class: "d-edit" },
      title,
      body,
      h(
        "div",
        { class: "d-admin-actions" },
        h("button", { class: "b-btn is-primary is-small", type: "button", text: "Save", onclick: () => adminUpdate(card.id, { title: title.value, body: body.value }, "Saved.") }),
        h("button", { class: "b-btn is-ghost is-small", type: "button", text: "Cancel", onclick: () => renderDetail() })
      )
    );
  }

  function commentNode(comment, cardId) {
    return h(
      "div",
      { class: `d-comment${comment.admin ? " is-admin" : ""}` },
      h("span", { class: `b-avatar${comment.admin ? " is-admin" : ""}`, "aria-hidden": "true", text: initial(comment.name || "A") }),
      h(
        "div",
        {},
        h(
          "div",
          { class: "d-comment-head" },
          h("strong", { text: comment.name || "Anonymous" }),
          comment.admin ? h("span", { class: "d-badge", text: "Team" }) : null,
          h("span", { title: fullDate(comment.createdAt), text: ago(comment.createdAt) }),
          state.admin
            ? h("button", {
                class: "d-comment-del",
                type: "button",
                text: "Remove",
                onclick: async () => {
                  try {
                    await api({ action: "deleteComment", id: cardId, commentId: comment.id });
                    comments = comments.filter((item) => item.id !== comment.id);
                    const card = state.cards.find((item) => item.id === cardId);
                    if (card) card.comments = comments.length;
                    renderDetail();
                    render();
                  } catch (error) {
                    toast(error.message);
                  }
                },
              })
            : null
        ),
        h("p", { text: comment.body })
      )
    );
  }

  function replyForm(card) {
    const text = h("textarea", { class: "b-input", rows: "2", maxlength: "2000", placeholder: state.admin ? "Reply as the team" : card.type === "bug" ? "Seeing this too? Add what’s different on your setup." : "Add a thought", "aria-label": "Comment" });
    const name = h("input", { class: "b-input", maxlength: "40", placeholder: "Your name (optional)", autocomplete: "nickname", "aria-label": "Your name", value: read("hb-name") || "" });
    const trap = h("input", { name: "website", tabindex: "-1", autocomplete: "off", class: "b-hp", "aria-hidden": "true" });
    const send = h("button", { class: "b-btn is-primary", type: "submit", text: "Comment" });
    const submit = async (event) => {
      event.preventDefault();
      if (!text.value.trim()) return text.focus();
      send.disabled = true;
      try {
        if (!state.admin) write("hb-name", name.value.trim());
        const data = await api({ action: "comment", id: card.id, body: text.value, name: name.value, website: trap.value });
        if (data.comment) comments.push(data.comment);
        const found = state.cards.find((item) => item.id === card.id);
        if (found && data.comments) found.comments = data.comments;
        renderDetail();
        render();
      } catch (error) {
        toast(error.message);
        send.disabled = false;
      }
    };
    return h("form", { class: "d-reply", onsubmit: submit }, text, h("div", { class: "d-reply-row" }, state.admin ? h("span", { style: "flex: 1" }) : name, send), trap);
  }

  function renderDetail({ editing = false } = {}) {
    const card = state.cards.find((item) => item.id === openId);
    if (!card) {
      detail.close();
      return;
    }
    const vote = voteButton(card);
    vote.dataset.for = card.id;
    const copyLink = h(
      "button",
      {
        class: "b-x",
        type: "button",
        "aria-label": "Copy link",
        title: "Copy link",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(`${location.origin}${location.pathname}#p-${card.id}`);
            toast("Link copied.");
          } catch {
            toast("Couldn’t copy the link.");
          }
        },
      },
      icon("link")
    );
    const tagType = h("span", { class: "b-tag", text: TYPE_NAME[card.type] });
    const top = h("div", { class: "d-top" }, statusChip(card), tagType, card.source === "app" ? h("span", { class: "b-tag" }, icon("app"), card.appVersion ? `App v${card.appVersion}` : "App") : null, h("span", { style: "margin-left: auto; display: flex; gap: 2px" }, copyLink, h("button", { class: "b-x", type: "button", "aria-label": "Close", onclick: () => detail.close() }, icon("close"))));

    const head = editing ? editPanel(card) : h("div", { class: "d-head" }, h("h2", { class: "d-title", id: "d-title", text: card.title }), vote);

    const meta = h(
      "div",
      { class: "b-meta" },
      h("span", { class: "b-avatar", "aria-hidden": "true", text: initial(card.name || "A") }),
      h("span", { class: "b-who", text: card.name || "Anonymous" }),
      h("span", { class: "b-when", title: fullDate(card.createdAt), text: ago(card.createdAt) })
    );

    // A post with a Discord thread: follow it there to hear when it moves or gets an answer.
    const follow = detailLinks.discord
      ? h(
          "a",
          { class: "d-follow", href: detailLinks.discord, target: "_blank", rel: "noopener", title: "Follow the thread on Discord to hear when this moves or gets an answer" },
          icon("discord"),
          h("span", {}, h("b", { text: "Follow on Discord" }), h("small", { text: "Get pinged when this moves or gets an answer" })),
          icon("arrow")
        )
      : null;

    const setup = card.setup
      ? h("details", { class: "d-setup" }, h("summary", {}, h("span", { text: "Setup" }), icon("chev")), h("pre", { text: card.setup }))
      : null;

    const thread = h(
      "section",
      { class: "d-comments", "aria-label": "Comments" },
      h("p", { class: "d-comments-title", text: commentsLoaded ? `${comments.length} comment${comments.length === 1 ? "" : "s"}` : "Comments" }),
      ...(commentsLoaded ? comments.map((comment) => commentNode(comment, card.id)) : [h("p", { class: "d-none", text: "Loading…" })]),
      commentsLoaded && !comments.length ? h("p", { class: "d-none", text: "No comments yet." }) : null,
      replyForm(card)
    );

    detailBody.replaceChildren(...[top, head, editing ? null : h("p", { class: "d-body", text: card.body || "" }), setup, meta, editing ? null : follow, state.admin && !editing ? adminPanel(card) : null, thread].filter(Boolean));
  }

  async function openDetail(id, { fromHash = false } = {}) {
    if (!state.cards.some((card) => card.id === id)) {
      if (fromHash) toast("That post is gone.");
      return;
    }
    openId = id;
    comments = [];
    commentsLoaded = false;
    detailLinks = {};
    renderDetail();
    if (!detail.open) detail.showModal();
    if (!fromHash) history.replaceState(null, "", `#p-${id}`);
    try {
      const data = await api(null, `?id=${encodeURIComponent(id)}`);
      if (openId !== id) return;
      comments = data.comments || [];
      commentsLoaded = true;
      detailLinks = data.links || {};
      const index = state.cards.findIndex((card) => card.id === id);
      if (index >= 0) state.cards[index] = { ...state.cards[index], ...data.card };
      renderDetail();
    } catch (error) {
      if (openId !== id) return;
      commentsLoaded = true;
      renderDetail();
      toast(error.message);
    }
  }

  detail.addEventListener("close", () => {
    openId = "";
    if (location.hash.startsWith("#p-")) history.replaceState(null, "", location.pathname + location.search);
  });

  /* ── Dialogs: close on the scrim and the X ─────────────────────────── */

  $$("dialog.b-sheet").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    $$("[data-close]", dialog).forEach((button) => button.addEventListener("click", () => dialog.close()));
  });

  /* ── Admin ─────────────────────────────────────────────────────────── */

  const login = $("[data-login]");
  $("[data-admin]").addEventListener("click", () => {
    if (state.admin) {
      toast("You’re signed in as admin.");
      return;
    }
    $("[data-login-error]").hidden = true;
    login.showModal();
    $("[data-password]").focus();
  });
  $("[data-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("[data-login-error]");
    try {
      await api({ action: "login", password: $("[data-password]").value });
      $("[data-password]").value = "";
      login.close();
      await load();
      toast("Signed in. Drag cards to arrange them.");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  $("[data-logout]").addEventListener("click", async () => {
    await api({ action: "logout" }).catch(() => null);
    state.admin = false;
    render();
    toast("Signed out.");
  });

  // Drag and drop, for the admin: within a column to set its order, across columns to move a post.
  let dragId = "";
  const marker = h("div", { class: "b-drop", "aria-hidden": "true" });

  function wireDrag(node) {
    node.addEventListener("dragstart", (event) => {
      dragId = node.dataset.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragId);
      requestAnimationFrame(() => node.classList.add("is-dragging"));
    });
    node.addEventListener("dragend", () => {
      node.classList.remove("is-dragging");
      marker.remove();
      $$(".b-list.is-over").forEach((list) => list.classList.remove("is-over"));
      dragId = "";
    });
  }

  const beforeNode = (list, y) =>
    $$(".b-card:not(.is-dragging)", list).find((card) => {
      const box = card.getBoundingClientRect();
      return y < box.top + box.height / 2;
    }) || null;

  $$("[data-list]").forEach((list) => {
    list.addEventListener("dragover", (event) => {
      if (!dragId) return;
      event.preventDefault();
      list.classList.add("is-over");
      const before = beforeNode(list, event.clientY);
      if (before) list.insertBefore(marker, before);
      else list.append(marker);
    });
    list.addEventListener("dragleave", (event) => {
      if (!list.contains(event.relatedTarget)) {
        list.classList.remove("is-over");
        marker.remove();
      }
    });
    list.addEventListener("drop", async (event) => {
      event.preventDefault();
      list.classList.remove("is-over");
      const id = dragId || event.dataTransfer.getData("text/plain");
      const card = state.cards.find((item) => item.id === id);
      if (!card) return;
      const type = list.dataset.list;
      const order = [...list.children].flatMap((child) => (child === marker ? [id] : child.dataset.id && child.dataset.id !== id ? [child.dataset.id] : []));
      marker.remove();
      if (!order.includes(id)) order.push(id);

      const fromType = card.type;
      order.forEach((cardId, pos) => {
        const item = state.cards.find((c) => c.id === cardId);
        if (item) Object.assign(item, { pos, type });
      });
      if (state.sort !== "board") {
        state.sort = "board";
        $("[data-sort]").value = "board";
        write("hb-sort", "board");
        toast("Showing board order.");
      }
      render();
      try {
        await api({ action: "arrange", type, ids: order });
        if (fromType !== type) toast(`Moved to ${TYPE_NAME[type]}s.`);
      } catch (error) {
        toast(error.message);
        load();
      }
    });
  });

  /* ── Toolbar, tabs, keys ───────────────────────────────────────────── */

  $$("[data-new]").forEach((button) => button.addEventListener("click", () => openCompose(button.dataset.new || "idea")));

  const search = $("[data-search]");
  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value.trim();
      render();
    }, 120);
  });

  const sort = $("[data-sort]");
  sort.value = sorters[state.sort] ? state.sort : "board";
  sort.addEventListener("change", () => {
    state.sort = sort.value;
    write("hb-sort", state.sort);
    render();
  });

  function syncTabs() {
    const tabs = $$("[data-tab]");
    tabs.forEach((tab, i) => {
      const on = tab.dataset.tab === state.tab;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) $("[data-tabs]").style.setProperty("--i", i);
    });
    $$("[data-col]").forEach((col) => col.classList.toggle("is-shown", col.dataset.col === state.tab));
  }
  $$("[data-tab]").forEach((tab, i, all) => {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      syncTabs();
    });
    tab.addEventListener("keydown", (event) => {
      const dir = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      event.preventDefault();
      const next = all[(i + dir + all.length) % all.length];
      state.tab = next.dataset.tab;
      syncTabs();
      next.focus();
    });
  });

  document.addEventListener("keydown", (event) => {
    const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
    if (typing || event.metaKey || event.ctrlKey || event.altKey || $("dialog[open]")) return;
    if (event.key === "/") {
      event.preventDefault();
      search.focus();
    }
  });

  $("[data-retry]").addEventListener("click", async () => {
    $("[data-board]").hidden = false;
    $("[data-tabs]").hidden = false;
    $("[data-offline]").hidden = true;
    skeleton();
    await load();
  });

  window.addEventListener("hashchange", () => {
    const match = /^#p-([\w-]+)$/.exec(location.hash);
    if (match && match[1] !== openId) openDetail(match[1], { fromHash: true });
  });

  /* ── Start ─────────────────────────────────────────────────────────── */

  // Relative times stay right while the page is open.
  setInterval(() => {
    if (!state.loaded || $("dialog[open]")) return;
    $$(".b-card .b-when").forEach((node) => {
      const card = state.cards.find((item) => item.id === node.closest(".b-card").dataset.id);
      if (card) node.textContent = ago(card.createdAt);
    });
  }, 60_000);

  skeleton();
  syncTabs();
  load().then((ok) => {
    if (!ok) return;
    // A link to one post, or the app's "open on the website" with a prefilled post.
    const match = /^#p-([\w-]+)$/.exec(location.hash);
    if (match) openDetail(match[1], { fromHash: true });
    const params = new URLSearchParams(location.search);
    const type = params.get("new");
    if (type !== null) {
      openCompose(TYPES.includes(type) ? type : "idea", { title: params.get("title") || "", body: params.get("body") || "", setup: params.get("setup") || "" });
      history.replaceState(null, "", location.pathname + location.hash);
    }
  });
})();
