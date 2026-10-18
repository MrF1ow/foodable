// Nutrition › Arrange: reorder cards client-side, save once.
document.querySelectorAll(".nutrition-arrange-form").forEach((form) => {
    const list = form.querySelector(".nutrition-arrange-list");
    if (!list) return;

    form.querySelectorAll(".arrange-legacy-move").forEach((el) => {
        el.hidden = true;
    });

    const initialOrder = () =>
        [...list.querySelectorAll(".arrange-row")].map(
            (row) => row.getAttribute("data-card") ?? "",
        );

    let baseline = initialOrder();

    const syncDisabled = () => {
        const rows = [...list.querySelectorAll(".arrange-row")];
        rows.forEach((row, index) => {
            const up = row.querySelector(".arrange-up");
            const down = row.querySelector(".arrange-down");
            if (up) up.disabled = index === 0;
            if (down) down.disabled = index === rows.length - 1;
        });
    };

    const moveRow = (row, direction) => {
        const rows = [...list.querySelectorAll(".arrange-row")];
        const index = rows.indexOf(row);
        if (index === -1) return;
        const swap = direction === "up" ? index - 1 : index + 1;
        if (swap < 0 || swap >= rows.length) return;
        const sibling = rows[swap];
        if (direction === "up") {
            list.insertBefore(row, sibling);
        } else {
            list.insertBefore(sibling, row);
        }
        syncDisabled();
        const primary = row.querySelector(
            direction === "up" ? ".arrange-up" : ".arrange-down",
        );
        const alternate = row.querySelector(
            direction === "up" ? ".arrange-down" : ".arrange-up",
        );
        const focusBtn =
            primary instanceof HTMLButtonElement && !primary.disabled
                ? primary
                : alternate instanceof HTMLButtonElement && !alternate.disabled
                  ? alternate
                  : null;
        if (focusBtn) focusBtn.focus();
    };

    list.addEventListener("click", (e) => {
        const btn =
            e.target instanceof Element
                ? e.target.closest(".arrange-up, .arrange-down")
                : null;
        if (!btn || btn.disabled) return;
        const row = btn.closest(".arrange-row");
        if (!row) return;
        e.preventDefault();
        moveRow(row, btn.classList.contains("arrange-up") ? "up" : "down");
    });

    const resetBtn = form.querySelector(".arrange-reset");
    const dialog = form.closest("dialog");
    const resetList = () => {
        const byCard = new Map(
            [...list.querySelectorAll(".arrange-row")].map((row) => [
                row.getAttribute("data-card"),
                row,
            ]),
        );
        for (const key of baseline) {
            const row = byCard.get(key);
            if (row) list.appendChild(row);
        }
        syncDisabled();
    };
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            resetList();
            if (dialog && typeof dialog.close === "function") dialog.close();
        });
    }

    syncDisabled();
});
