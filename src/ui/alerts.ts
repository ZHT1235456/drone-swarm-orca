import { AlertEvent } from '../core/swarm';

const MAX_ALERTS = 40;

/**
 * 右侧栏底部告警流。
 */
export class AlertsPanel {
  private listEl: HTMLElement;

  constructor(root: HTMLElement) {
    const el = document.createElement('div');
    el.id = 'alerts-panel';
    el.innerHTML = `
      <div class="section-title"><span>事件日志 EVENT LOG</span><span class="dot"></span></div>
      <div id="alerts-list"></div>
    `;
    root.appendChild(el);
    this.listEl = el.querySelector('#alerts-list')!;
  }

  push(e: AlertEvent): void {
    const item = document.createElement('div');
    item.className = `alert-item ${e.severity}`;
    const mm = String(Math.floor(e.time / 60)).padStart(2, '0');
    const ss = String(Math.floor(e.time % 60)).padStart(2, '0');
    const icon = e.severity === 'critical' ? '■' : e.severity === 'warn' ? '▲' : '●';
    item.innerHTML = `<span class="time">T+${mm}:${ss}</span><span>${icon} ${e.message}</span>`;
    this.listEl.appendChild(item);

    while (this.listEl.children.length > MAX_ALERTS) {
      this.listEl.removeChild(this.listEl.firstChild!);
    }
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }
}
