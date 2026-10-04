/**
 * Task links management.
 *
 * Stored records are treated as untrusted input on every render. URLs pass a
 * strict http/https policy, text is assigned with textContent, and link actions
 * are delegated from the rendered list without inline JavaScript.
 */
(function installTaskLinks(global) {
    if (!global) return;

    function unwrap(value, fallback) {
        if (value && typeof value === 'object' && 'success' in value && 'value' in value) {
            return value.success ? value.value : fallback;
        }
        return value === undefined ? fallback : value;
    }

    function getDocument() {
        return global.document || (typeof document !== 'undefined' ? document : null);
    }

    function storageAdapter() {
        if (global.StorageAdapter?.getStorage) {
            try { return global.StorageAdapter.getStorage(); } catch {}
        }
        if (global.StorageService) return global.StorageService;
        if (typeof global.getStorage === 'function') {
            try { return global.getStorage(); } catch {}
        }
        const backend = global.localStorage;
        if (!backend) return null;
        return {
            get(key, fallback) {
                const raw = backend.getItem(key);
                if (raw === null) return fallback;
                try { return JSON.parse(raw); } catch { return raw; }
            },
            set(key, value) {
                backend.setItem(key, JSON.stringify(value));
                return { success: true, status: 'success', value };
            }
        };
    }

    function assertWrite(outcome) {
        return outcome !== false && !(outcome && typeof outcome === 'object' &&
            ('success' in outcome || 'ok' in outcome) && outcome.success !== true && outcome.ok !== true);
    }

    class TaskLinksManager {
        constructor(options = {}) {
            this.db = options.db || null;
            this.storage = options.storage || null;
            this.initializeFirestore();
        }

        async initializeFirestore() {
            try {
                if (global.db) {
                    this.db = global.db;
                    return this.db;
                }
                if (global.firebase?.firestore) {
                    if (Array.isArray(global.firebase.apps) && global.firebase.apps.length === 0 && global.firebase.initializeApp) {
                        global.firebase.initializeApp();
                    }
                    this.db = global.firebase.firestore();
                }
            } catch (error) {
                console.warn('[taskLinks] Firestore unavailable:', error.message);
            }
            return this.db;
        }

        _storage() {
            if (!this.storage) this.storage = storageAdapter();
            return this.storage;
        }

        _validatedIdentifier(value) {
            if (value === null || value === undefined) return null;
            const normalized = String(value);
            if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
            return normalized;
        }

        _read(key, fallback) {
            const storage = this._storage();
            if (!storage?.get) return fallback;
            try { return unwrap(storage.get(key, fallback), fallback); } catch { return fallback; }
        }

        _write(key, value) {
            const storage = this._storage();
            if (!storage?.set) throw new Error('Storage is unavailable');
            const outcome = storage.set(key, value);
            if (!assertWrite(outcome)) throw new Error(`Storage write failed${outcome?.status ? ` (${outcome.status})` : ''}`);
            return outcome;
        }

        sanitizeUrl(value, options = {}) {
            const raw = String(value ?? '').trim();
            if (!raw) throw new Error('URL is required');
            const allowBare = options.allowBare !== false;
            const candidate = allowBare && !/^[a-z][a-z0-9+.-]*:/i.test(raw) ? `https://${raw}` : raw;
            let parsed;
            try { parsed = new URL(candidate); } catch { throw new Error('Invalid URL format'); }
            if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http and https links are allowed');
            if (!parsed.hostname) throw new Error('URL hostname is required');
            return parsed.toString();
        }

        getLinkType(url) {
            const lower = String(url).toLowerCase();
            if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
            if (lower.includes('docs.google.com') || /\.(pdf|docx?|odt)(?:[?#]|$)/i.test(lower)) return 'document';
            if (lower.includes('github.com')) return 'github';
            if (lower.includes('medium.com') || lower.includes('dev.to') || lower.includes('blog')) return 'article';
            return 'link';
        }

        extractTitle(url) {
            try {
                const parsed = new URL(url);
                let title = parsed.hostname.replace(/^www\./i, '');
                if (/youtube\.com\/watch/i.test(url)) title += ' - Video';
                if (/youtube\.com\/playlist/i.test(url)) title += ' - Playlist';
                return title;
            } catch { return 'Saved link'; }
        }

        async addLink(taskId, linkData = {}) {
            const normalizedTaskId = this._validatedIdentifier(taskId);
            if (!normalizedTaskId) throw new Error('A valid task ID is required');
            const url = this.sanitizeUrl(linkData.url, { allowBare: true });
            const link = {
                id: `link_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                url,
                title: String(linkData.title || this.extractTitle(url)),
                type: this.getLinkType(url),
                addedAt: new Date().toISOString(),
                description: String(linkData.description || '')
            };

            const localResult = await this.updateLocalStorage(normalizedTaskId, link);
            if (!localResult.success) throw new Error(localResult.error || 'Could not save link locally');
            await this.updateFirestore(normalizedTaskId, link);
            global.crossTabSync?.send?.('task-links-update', { taskId: normalizedTaskId, action: 'add' });
            return { success: true, link };
        }

        async updateLocalStorage(taskId, link) {
            try {
                const tasks = this._read('calculatedPriorityTasks', []);
                if (!Array.isArray(tasks)) throw new Error('Priority task data is unavailable');
                const taskIndex = tasks.findIndex(task => String(task?.id) === String(taskId));
                if (taskIndex < 0) throw new Error('Task not found in priority list');

                const task = { ...tasks[taskIndex] };
                task.links = Array.isArray(task.links) ? [...task.links, link] : [link];
                const nextTasks = [...tasks];
                nextTasks[taskIndex] = task;
                if (global.TaskService?.updateTaskInPriority) {
                    await global.TaskService.updateTaskInPriority(taskId, { links: task.links });
                } else {
                    this._write('calculatedPriorityTasks', nextTasks);
                }

                if (task.projectId) {
                    const projectTasks = this._read(`tasks-${task.projectId}`, []);
                    if (Array.isArray(projectTasks)) {
                        const projectIndex = projectTasks.findIndex(candidate => String(candidate?.id) === String(taskId));
                        if (projectIndex >= 0) {
                            const nextProjectTasks = [...projectTasks];
                            nextProjectTasks[projectIndex] = {
                                ...nextProjectTasks[projectIndex],
                                links: Array.isArray(nextProjectTasks[projectIndex].links)
                                    ? [...nextProjectTasks[projectIndex].links, link]
                                    : [link]
                            };
                            this._write(`tasks-${task.projectId}`, nextProjectTasks);
                        }
                    }
                }
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        async updateFirestore(taskId, link) {
            if (!this.db) return { success: false, error: 'Firestore not initialized' };
            const user = global.auth?.currentUser;
            if (!user?.uid) return { success: false, error: 'No authenticated user' };
            try {
                const task = this._read('calculatedPriorityTasks', []).find(candidate => String(candidate?.id) === String(taskId));
                if (!task?.projectId) return { success: false, error: 'Task project is unavailable' };
                const ref = this.db.collection('users').doc(user.uid).collection('tasks').doc(task.projectId);
                const snapshot = await ref.get();
                if (!snapshot.exists) return { success: false, error: 'Tasks document not found' };
                const data = snapshot.data() || {};
                const tasks = Array.isArray(data.tasks) ? [...data.tasks] : [];
                const index = tasks.findIndex(candidate => String(candidate?.id) === String(taskId));
                if (index < 0) return { success: false, error: 'Task not found in Firestore' };
                tasks[index] = { ...tasks[index], links: [...(tasks[index].links || []), link], updatedAt: new Date().toISOString() };
                await ref.set({ ...data, tasks, lastUpdated: new Date(), version: Date.now() });
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        renderLinks(taskId, container) {
            const normalizedTaskId = this._validatedIdentifier(taskId);
            const linksList = container?.querySelector?.('.links-list') || container;
            if (!normalizedTaskId || !linksList) return;
            const tasks = this._read('calculatedPriorityTasks', []);
            const task = Array.isArray(tasks) ? tasks.find(candidate => String(candidate?.id) === normalizedTaskId) : null;
            if (!task) {
                this._renderMessage(linksList, 'Task not found for these links.');
                return;
            }
            const links = Array.isArray(task.links) ? task.links : [];
            if (!links.length) {
                this._renderMessage(linksList, 'No links added yet. Click “Add New Link” to get started.');
                return;
            }
            if (linksList.replaceChildren) linksList.replaceChildren();
            else linksList.textContent = '';
            links.forEach(link => linksList.appendChild(this.createLinkElement(link, normalizedTaskId)));
            this._ensureDelegatedHandlers(linksList, normalizedTaskId);
        }

        createLinkElement(link, taskId) {
            const documentRef = getDocument();
            if (!documentRef?.createElement) throw new Error('A document is required to render links');
            const item = documentRef.createElement('div');
            item.className = 'link-item';
            item.dataset.taskId = this._validatedIdentifier(taskId) || '';

            const linkId = this._validatedIdentifier(link?.id);
            if (linkId) item.dataset.linkId = linkId;

            const icon = documentRef.createElement('div');
            icon.className = 'link-icon';
            const iconElement = documentRef.createElement('i');
            iconElement.className = `bi ${this._iconForType(link?.type)}`;
            iconElement.setAttribute('aria-hidden', 'true');
            icon.appendChild(iconElement);
            item.appendChild(icon);

            const content = documentRef.createElement('div');
            content.className = 'link-content';
            const title = documentRef.createElement('p');
            title.className = 'link-title';
            title.textContent = String(link?.title || 'Untitled link');
            content.appendChild(title);

            let safeUrl = null;
            let invalidReason = '';
            try {
                safeUrl = this.sanitizeUrl(link?.url, { allowBare: false });
            } catch (error) {
                invalidReason = error.message;
            }

            const urlContainer = documentRef.createElement('div');
            urlContainer.className = 'link-url';
            if (safeUrl) {
                const anchor = documentRef.createElement('a');
                anchor.href = safeUrl;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = new URL(safeUrl).hostname;
                urlContainer.appendChild(anchor);
                item.classList.add(this._safeType(link?.type));
            } else {
                item.dataset.invalid = 'true';
                const invalid = documentRef.createElement('span');
                invalid.className = 'text-danger';
                invalid.textContent = `Invalid stored link: ${invalidReason || 'URL is missing'}`;
                urlContainer.appendChild(invalid);
            }
            content.appendChild(urlContainer);

            if (link?.description) {
                const description = documentRef.createElement('div');
                description.className = 'link-description';
                description.textContent = String(link.description);
                content.appendChild(description);
            }
            item.appendChild(content);

            if (safeUrl && linkId && this._validatedIdentifier(taskId)) {
                const actions = documentRef.createElement('div');
                actions.className = 'link-actions';
                actions.appendChild(this._actionButton(documentRef, 'open-link', 'Open link', taskId, linkId));
                actions.appendChild(this._actionButton(documentRef, 'remove-link', 'Remove link', taskId, linkId, 'text-danger'));
                item.appendChild(actions);
            }
            return item;
        }

        async removeLink(taskId, linkId) {
            const normalizedTaskId = this._validatedIdentifier(taskId);
            const normalizedLinkId = this._validatedIdentifier(linkId);
            if (!normalizedTaskId || !normalizedLinkId) return { success: false, error: 'Invalid link identity' };
            try {
                const tasks = this._read('calculatedPriorityTasks', []);
                const taskIndex = Array.isArray(tasks) ? tasks.findIndex(task => String(task?.id) === normalizedTaskId) : -1;
                if (taskIndex < 0 || !Array.isArray(tasks[taskIndex].links)) throw new Error('Task or links not found');
                const links = [...tasks[taskIndex].links];
                const linkIndex = links.findIndex(link => String(link?.id) === normalizedLinkId);
                if (linkIndex < 0) throw new Error('Link not found');
                links.splice(linkIndex, 1);
                const nextTasks = [...tasks];
                nextTasks[taskIndex] = { ...tasks[taskIndex], links };
                if (global.TaskService?.updateTaskInPriority) await global.TaskService.updateTaskInPriority(normalizedTaskId, { links });
                else this._write('calculatedPriorityTasks', nextTasks);

                const task = nextTasks[taskIndex];
                if (task.projectId) {
                    const projectTasks = this._read(`tasks-${task.projectId}`, []);
                    if (Array.isArray(projectTasks)) {
                        const projectIndex = projectTasks.findIndex(candidate => String(candidate?.id) === normalizedTaskId);
                        if (projectIndex >= 0) {
                            const projectLinks = Array.isArray(projectTasks[projectIndex].links)
                                ? [...projectTasks[projectIndex].links] : [];
                            const projectLinkIndex = projectLinks.findIndex(link => String(link?.id) === normalizedLinkId);
                            if (projectLinkIndex >= 0) projectLinks.splice(projectLinkIndex, 1);
                            const nextProjectTasks = [...projectTasks];
                            nextProjectTasks[projectIndex] = { ...projectTasks[projectIndex], links: projectLinks };
                            this._write(`tasks-${task.projectId}`, nextProjectTasks);
                        }
                    }
                }
                const container = this._findLinksContainer(normalizedTaskId);
                if (container) this.renderLinks(normalizedTaskId, container);
                global.crossTabSync?.send?.('task-links-update', { taskId: normalizedTaskId, action: 'remove', linkId: normalizedLinkId });
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        toggleLinks(taskId) {
            const container = this._findLinksContainer(taskId);
            if (!container) return false;
            const expanded = container.classList.toggle('expanded');
            if (expanded) this.renderLinks(taskId, container);
            return expanded;
        }

        openAddLinkModal(taskId) {
            const normalizedTaskId = this._validatedIdentifier(taskId);
            const documentRef = getDocument();
            if (!normalizedTaskId || !documentRef?.createElement || !documentRef.body) throw new Error('A valid task ID is required');
            documentRef.querySelector?.('.add-link-modal')?.remove?.();
            documentRef.querySelector?.('.modal-overlay')?.remove?.();

            const overlay = documentRef.createElement('div');
            overlay.className = 'modal-overlay';
            const modal = documentRef.createElement('div');
            modal.className = 'add-link-modal';
            const title = documentRef.createElement('h3');
            title.textContent = 'Add New Link';
            modal.appendChild(title);
            const fields = [
                ['linkUrl', 'URL *', 'url', 'https://...', true],
                ['linkTitle', 'Title', 'text', 'Title (optional)', false],
                ['linkDescription', 'Description', 'textarea', 'Description (optional)', false]
            ];
            const inputs = {};
            fields.forEach(([id, labelText, kind, placeholder, required]) => {
                const group = documentRef.createElement('div');
                group.className = 'form-group';
                const label = documentRef.createElement('label');
                label.htmlFor = id;
                label.textContent = labelText;
                const input = documentRef.createElement(kind === 'textarea' ? 'textarea' : 'input');
                input.id = id;
                input.type = kind === 'textarea' ? undefined : kind;
                input.placeholder = placeholder;
                input.required = required;
                inputs[id] = input;
                group.append(label, input);
                modal.appendChild(group);
            });
            const actions = documentRef.createElement('div');
            actions.className = 'modal-actions';
            const cancel = documentRef.createElement('button');
            cancel.type = 'button';
            cancel.textContent = 'Cancel';
            const save = documentRef.createElement('button');
            save.type = 'button';
            save.textContent = 'Save Link';
            actions.append(cancel, save);
            modal.appendChild(actions);
            documentRef.body.append(overlay, modal);

            const close = () => { overlay.remove(); modal.remove(); };
            overlay.addEventListener('click', close);
            cancel.addEventListener('click', close);
            save.addEventListener('click', async () => {
                try {
                    await this.addLink(normalizedTaskId, {
                        url: inputs.linkUrl.value,
                        title: inputs.linkTitle.value,
                        description: inputs.linkDescription.value
                    });
                    const container = this._findLinksContainer(normalizedTaskId);
                    if (container) this.renderLinks(normalizedTaskId, container);
                    close();
                } catch (error) {
                    global.showNotification?.(`Error adding link: ${error.message}`, 'error');
                }
            });
            inputs.linkUrl.focus?.();
        }

        _renderMessage(container, text) {
            const documentRef = container.ownerDocument || getDocument();
            const message = documentRef.createElement('div');
            message.className = 'no-links-message';
            message.textContent = text;
            if (container.replaceChildren) container.replaceChildren(message);
            else { container.textContent = ''; container.appendChild(message); }
        }

        _ensureDelegatedHandlers(list, taskId) {
            if (list.dataset.taskLinksBound === 'true') return;
            list.addEventListener('click', event => {
                const action = event.target?.closest?.('[data-link-action]');
                if (!action) return;
                const linkId = this._validatedIdentifier(action.dataset.linkId);
                if (!linkId) return;
                if (action.dataset.linkAction === 'remove-link') void this.removeLink(taskId, linkId);
                if (action.dataset.linkAction === 'open-link') {
                    const task = this._read('calculatedPriorityTasks', []).find(candidate => String(candidate?.id) === String(taskId));
                    const record = task?.links?.find(link => String(link?.id) === linkId);
                    try {
                        const url = this.sanitizeUrl(record?.url, { allowBare: false });
                        global.open?.(url, '_blank', 'noopener,noreferrer');
                    } catch {}
                }
            });
            list.dataset.taskLinksBound = 'true';
        }

        _actionButton(documentRef, action, label, taskId, linkId, className = '') {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = className;
            button.dataset.linkAction = action;
            button.dataset.taskId = String(taskId);
            button.dataset.linkId = String(linkId);
            button.title = label;
            button.setAttribute('aria-label', label);
            const icon = documentRef.createElement('i');
            icon.className = action === 'open-link' ? 'bi bi-box-arrow-up-right' : 'bi bi-trash';
            icon.setAttribute('aria-hidden', 'true');
            button.appendChild(icon);
            return button;
        }

        _iconForType(type) {
            return {
                youtube: 'bi-youtube',
                document: 'bi-file-text',
                article: 'bi-newspaper',
                github: 'bi-github',
                link: 'bi-link-45deg'
            }[this._safeType(type)] || 'bi-link-45deg';
        }

        _safeType(type) {
            const allowed = new Set(['youtube', 'document', 'article', 'github', 'link']);
            return allowed.has(String(type)) ? String(type) : 'link';
        }

        _findLinksContainer(taskId) {
            const normalized = this._validatedIdentifier(taskId);
            const documentRef = getDocument();
            if (!normalized || !documentRef) return null;
            const containers = documentRef.querySelectorAll?.('.links-container') || [];
            for (const container of containers) {
                if (String(container.dataset?.taskId || '') === normalized) return container;
            }
            return documentRef.getElementById?.(`links-${normalized}`) || null;
        }
    }

    const manager = new TaskLinksManager();
    const taskLinks = {
        async saveLink(taskId, linkData = {}) {
            try {
                const normalizedTaskId = manager._validatedIdentifier(taskId);
                if (!normalizedTaskId) return false;
                const url = manager.sanitizeUrl(linkData.url, { allowBare: true });
                const all = manager._read('taskLinks', {});
                const records = all && typeof all === 'object' ? { ...all } : {};
                const list = Array.isArray(records[normalizedTaskId]) ? [...records[normalizedTaskId]] : [];
                list.push({
                    id: `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    url,
                    title: String(linkData.title || manager.extractTitle(url)),
                    description: String(linkData.description || ''),
                    type: manager.getLinkType(url)
                });
                records[normalizedTaskId] = list;
                manager._write('taskLinks', records);
                return true;
            } catch { return false; }
        },
        display(taskId) {
            const container = manager._findLinksContainer(taskId)?.querySelector?.('.links-list') || null;
            if (!container) return;
            const all = manager._read('taskLinks', {});
            const links = Array.isArray(all?.[taskId]) ? all[taskId] : [];
            if (container.replaceChildren) container.replaceChildren();
            links.forEach(link => container.appendChild(manager.createLinkElement(link, taskId)));
            manager._ensureDelegatedHandlers(container, taskId);
        },
        deleteLink(taskId, linkId) {
            const all = manager._read('taskLinks', {});
            const list = Array.isArray(all?.[taskId]) ? [...all[taskId]] : [];
            const index = list.findIndex(link => String(link?.id) === String(linkId));
            if (index < 0) return false;
            list.splice(index, 1);
            const next = { ...(all || {}), [taskId]: list };
            try { manager._write('taskLinks', next); this.display(taskId); return true; } catch { return false; }
        },
        getLinkType: url => manager.getLinkType(url),
        getLinkIcon: url => manager._iconForType(manager.getLinkType(url))
    };

    global.TaskLinksManager = TaskLinksManager;
    global.taskLinksManager = manager;
    global.taskLinks = taskLinks;
    global.saveTaskLink = async (taskId, data) => { const ok = await taskLinks.saveLink(taskId, data); if (ok) taskLinks.display(taskId); return ok; };
    global.displayTaskLinks = taskId => taskLinks.display(taskId);
    global.toggleTaskLinks = taskId => manager.toggleLinks(taskId);
    global.addNewLink = taskId => manager.openAddLinkModal(taskId);
    global.closeAddLinkModal = () => {
        getDocument()?.querySelector?.('.add-link-modal')?.remove?.();
        getDocument()?.querySelector?.('.modal-overlay')?.remove?.();
    };
})(typeof window !== 'undefined' ? window : null);
