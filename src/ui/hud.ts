import { Swarm } from '../core/swarm';

/**
 * 顶部状态栏:机队总览、最小间距、仿真时间、FPS。
 */
export class Hud {
  private el: HTMLElement;
  private valueEls: Record<string, HTMLElement> = {};

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'topbar';
    this.el.innerHTML = `
      <div class="brand">SWARM COMMAND<span>异构无人机集群指挥系统 v1.0</span></div>
      <div class="stat-item"><span class="label">在线 / 总数</span><span class="value" data-k="active">—</span></div>
      <div class="stat-item"><span class="label">故障</span><span class="value" data-k="failed">—</span></div>
      <div class="stat-item"><span class="label">平均电量</span><span class="value" data-k="battery">—</span></div>
      <div class="stat-item"><span class="label">最小间距</span><span class="value" data-k="sep">—</span></div>
      <div class="stat-item"><span class="label">近距告警</span><span class="value" data-k="prox">—</span></div>
      <div class="spacer"></div>
      <div class="stat-item"><span class="label">任务时间</span><span class="value" data-k="time">—</span></div>
      <div class="stat-item"><span class="label">FPS</span><span class="value" data-k="fps">—</span></div>
    `;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => {
      this.valueEls[e.dataset.k!] = e;
    });
  }

  update(swarm: Swarm, fps: number): void {
    const stats = swarm.getStats();
    const v = this.valueEls;

    v.active.textContent = `${stats.active} / ${stats.total}`;
    v.active.className = 'value ' + (stats.active === stats.total ? 'good' : 'warn');

    v.failed.textContent = String(stats.failed);
    v.failed.className = 'value ' + (stats.failed > 0 ? 'bad' : 'good');

    v.battery.textContent = `${Math.round(stats.avgBattery * 100)}%`;
    v.battery.className = 'value ' + (stats.avgBattery > 0.4 ? 'good' : stats.avgBattery > 0.2 ? 'warn' : 'bad');

    const sep = stats.minSeparation;
    v.sep.textContent = isFinite(sep) ? `${sep.toFixed(1)} m` : '—';
    v.sep.className = 'value ' + (sep > 1.5 || !isFinite(sep) ? 'good' : sep > 0.3 ? 'warn' : 'bad');

    v.prox.textContent = String(stats.proximityPairs);
    v.prox.className = 'value ' + (stats.proximityPairs === 0 ? 'good' : 'warn');

    const t = swarm.time;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    v.time.textContent = `T+${mm}:${ss}`;

    v.fps.textContent = String(Math.round(fps));
    v.fps.className = 'value ' + (fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad');
  }
}
