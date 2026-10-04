/**
 * alarms-ui.js
 * Controller for the redesigned Alarms page.
 * Handles: Add form, Edit modal, renderAlarms patch, toast notifications.
 */
document.addEventListener('DOMContentLoaded', () => {

    // ── AM/PM toggle (Add form) ────────────────────────────────────────
    let addAmpm = 'AM';
    document.querySelectorAll('.add-ampm .ampm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.add-ampm .ampm-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            addAmpm = btn.dataset.val;
        });
    });

    // ── Day pill toggle (Add form) ─────────────────────────────────────
    document.querySelectorAll('.add-day-pills .day-pill').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
    });

    // ── Submit new alarm ───────────────────────────────────────────────
    document.getElementById('addAlarmSubmitBtn').addEventListener('click', () => {
        const timeVal = document.getElementById('newAlarmTimePicker').value;
        if (!timeVal) { showToast('Please pick a time first.', 'warning'); return; }

        let [h, m] = timeVal.split(':').map(Number);
        let ampm;
        if (h === 0)       { h = 12; ampm = 'AM'; }
        else if (h === 12) { ampm = 'PM'; }
        else if (h > 12)   { h -= 12; ampm = 'PM'; }
        else               { ampm = 'AM'; }

        const label = document.getElementById('newAlarmLabel').value.trim();
        const days  = Array.from(document.querySelectorAll('.add-day-pills .day-pill.selected'))
                           .map(p => parseInt(p.dataset.day));

        if (window.alarmService) {
            window.alarmService.addAlarm(h, m, ampm, label, { recurring: days.length > 0, days });
            showToast(`Alarm set for ${h}:${m.toString().padStart(2,'0')} ${ampm}`, 'success');
        }

        // Reset form
        document.getElementById('newAlarmTimePicker').value = '';
        document.getElementById('newAlarmLabel').value = '';
        document.querySelectorAll('.add-day-pills .day-pill').forEach(p => p.classList.remove('selected'));
        document.querySelectorAll('.add-ampm .ampm-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.add-ampm .ampm-btn[data-val="AM"]').classList.add('active');
        addAmpm = 'AM';
    });

    // ── Edit Modal ─────────────────────────────────────────────────────
    let editingAlarmId = null;
    let editAmpm = 'AM';

    window.openEditAlarmModal = function(alarmId) {
        if (!window.alarmService) return;
        const alarm = window.alarmService.alarms.find(a => a.id === alarmId);
        if (!alarm) return;
        editingAlarmId = alarmId;

        let h24 = alarm.hour;
        if (alarm.ampm === 'PM' && h24 !== 12) h24 += 12;
        if (alarm.ampm === 'AM' && h24 === 12) h24 = 0;
        document.getElementById('editAlarmTimePicker').value =
            `${h24.toString().padStart(2,'0')}:${alarm.minute.toString().padStart(2,'0')}`;

        editAmpm = alarm.ampm;
        document.querySelectorAll('.edit-ampm .ampm-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.val === alarm.ampm);
        });

        document.getElementById('editAlarmLabel').value = alarm.label || '';

        document.querySelectorAll('.edit-day-pills .day-pill').forEach(p => {
            p.classList.toggle('selected', alarm.days && alarm.days.includes(parseInt(p.dataset.day)));
        });

        const overlay = document.getElementById('editAlarmOverlay');
        overlay.classList.remove('d-none');
        requestAnimationFrame(() => overlay.querySelector('.alarm-modal-panel').classList.add('open'));
    };

    document.querySelectorAll('.edit-ampm .ampm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.edit-ampm .ampm-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            editAmpm = btn.dataset.val;
        });
    });

    document.querySelectorAll('.edit-day-pills .day-pill').forEach(btn => {
        btn.addEventListener('click', () => btn.classList.toggle('selected'));
    });

    function closeEditModal() {
        const overlay = document.getElementById('editAlarmOverlay');
        overlay.querySelector('.alarm-modal-panel').classList.remove('open');
        setTimeout(() => overlay.classList.add('d-none'), 250);
        editingAlarmId = null;
    }

    document.getElementById('editModalCloseBtn').addEventListener('click', closeEditModal);
    document.getElementById('editModalCancelBtn').addEventListener('click', closeEditModal);
    document.getElementById('editAlarmOverlay').addEventListener('click', e => {
        if (e.target === document.getElementById('editAlarmOverlay')) closeEditModal();
    });

    document.getElementById('editModalSaveBtn').addEventListener('click', () => {
        if (!editingAlarmId || !window.alarmService) return;
        const alarm = window.alarmService.alarms.find(a => a.id === editingAlarmId);
        if (!alarm) return;

        const timeVal = document.getElementById('editAlarmTimePicker').value;
        if (!timeVal) { showToast('Please pick a time.', 'warning'); return; }

        let [h, m] = timeVal.split(':').map(Number);
        if (h === 0)       { h = 12; editAmpm = 'AM'; }
        else if (h === 12) { editAmpm = 'PM'; }
        else if (h > 12)   { h -= 12; editAmpm = 'PM'; }
        else               { editAmpm = 'AM'; }

        const days = Array.from(document.querySelectorAll('.edit-day-pills .day-pill.selected'))
                          .map(p => parseInt(p.dataset.day));

        alarm.hour      = h;
        alarm.minute    = m;
        alarm.ampm      = editAmpm;
        alarm.label     = document.getElementById('editAlarmLabel').value.trim();
        alarm.days      = days;
        alarm.recurring = days.length > 0;

        window.alarmService.saveAlarms();
        showToast('Alarm updated!', 'success');
        closeEditModal();
    });

    // ── Patch renderAlarms with new card design ────────────────────────
    function patchRenderAlarms() {
        if (!window.alarmService) { setTimeout(patchRenderAlarms, 300); return; }

        window.alarmService.renderAlarms = function() {
            const list       = document.getElementById('alarm-list');
            const emptyState = document.getElementById('alarmEmptyState');
            const badge      = document.getElementById('alarmCountBadge');
            if (!list) return;

            list.innerHTML = '';
            const count = this.alarms.length;
            if (badge) badge.textContent = `${count} alarm${count !== 1 ? 's' : ''}`;
            if (emptyState) emptyState.style.display = count === 0 ? 'flex' : 'none';

            const to24 = x => {
                let h = x.hour;
                if (x.ampm === 'PM' && h !== 12) h += 12;
                if (x.ampm === 'AM' && h === 12) h = 0;
                return h * 60 + x.minute;
            };
            const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

            [...this.alarms]
                .sort((a, b) => to24(a) - to24(b))
                .forEach(alarm => {
                    const repeatText = alarm.days && alarm.days.length > 0
                        ? alarm.days.map(d => dayNames[d]).join(', ')
                        : 'One-time';

                    const card = document.createElement('div');
                    card.className = `alarm-card${alarm.enabled ? '' : ' alarm-disabled'}`;
                    card.setAttribute('role', 'listitem');
                    card.innerHTML = `
                        <div class="alarm-card-time">
                            ${alarm.hour}:${alarm.minute.toString().padStart(2,'0')}
                            <span class="alarm-card-ampm">${alarm.ampm}</span>
                        </div>
                        <div class="alarm-card-meta">
                            <div class="alarm-card-label">${alarm.label || 'Alarm'}</div>
                            <div class="alarm-card-repeat">
                                <i class="bi bi-arrow-repeat"></i> ${repeatText}
                            </div>
                        </div>
                        <div class="alarm-card-controls">
                            <label class="toggle-switch" title="${alarm.enabled ? 'Disable alarm' : 'Enable alarm'}">
                                <input type="checkbox" ${alarm.enabled ? 'checked' : ''}>
                                <span class="toggle-track"></span>
                            </label>
                            <button class="alarm-icon-btn edit-btn" title="Edit alarm">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="alarm-icon-btn delete-btn" title="Delete alarm">
                                <i class="bi bi-trash3"></i>
                            </button>
                        </div>
                    `;

                    card.querySelector('.toggle-switch input').addEventListener('change', () => {
                        this.toggleAlarm(alarm.id);
                    });
                    card.querySelector('.edit-btn').addEventListener('click', () => {
                        window.openEditAlarmModal(alarm.id);
                    });
                    card.querySelector('.delete-btn').addEventListener('click', () => {
                        card.style.animation = 'alarmSlideOut 0.3s ease forwards';
                        setTimeout(() => this.removeAlarm(alarm.id), 280);
                    });

                    list.appendChild(card);
                });
        };

        window.alarmService.renderAlarms();
    }

    patchRenderAlarms();

    // ── Toast helper ───────────────────────────────────────────────────
    function showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `gpace-toast gpace-toast-${type}`;
        toast.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i> ${msg}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    }
    // ── One-time cleanup: remove duplicates already in storage ────────
    function deduplicateExistingAlarms() {
        if (!window.alarmService) { setTimeout(deduplicateExistingAlarms, 400); return; }

        const seen = new Set();
        const cleaned = [];
        let removedCount = 0;

        window.alarmService.alarms.forEach(alarm => {
            // Key: label + time + days sorted
            const key = `${alarm.label}|${alarm.hour}:${alarm.minute}${alarm.ampm}|${(alarm.days || []).slice().sort().join(',')}`;
            if (!seen.has(key)) {
                seen.add(key);
                cleaned.push(alarm);
            } else {
                removedCount++;
            }
        });

        if (removedCount > 0) {
            window.alarmService.alarms = cleaned;
            window.alarmService.saveAlarms();
            console.log(`[AlarmsUI] Removed ${removedCount} duplicate alarm(s).`);
        }
    }

    deduplicateExistingAlarms();
});
