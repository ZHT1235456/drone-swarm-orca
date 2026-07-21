import { Drone, DroneStatus, STATUS_LABEL_ZH, DRONE_SPECS, DroneType } from '../core/drone';
import { Swarm } from '../core/swarm';

/**
 * 右侧遥测面板:机队构成 + 选中单机详情。
 */
export class TelemetryPanel {
  private el: HTMLElement;
  private bodyEl: HTMLElement;
  selectedDrone: Drone | null = null;

  constructor(root: HTMLElement, swarm: Swarm) {
    this.el = document.createElement('div');
    this.el.id = 'telemetry-panel';

    const stats = swarm.getStats();
    const typeColors = ['#2ce8f5', '#ffb02e', '#b44df0'];
    const comps = [DroneType.Scout, DroneType.Cargo, DroneType.Relay]
      .map((t) => {
        const spec = DRONE_SPECS[t];
        return `<div class="fleet-type">
          <div class="swatch" style="background:${typeColors[t]};box-shadow:0 0 6px ${typeColors[t]}"></div>
          <span class="name">${spec.name} ${spec.nameZh}</span>
          <span class="count" data-type="${t}">${stats.byType[t]}</span>
        </div>`;
      })
      .join('');

    this.el.innerHTML = `
      <div class="sidebar-section">
        <div class="section-title"><span>机队构成 FLEET</span><span class="dot"></span></div>
        <div class="fleet-comp">${comps}</div>
      </div>
      <div class="sidebar-section flex-fill">
        <div class="section-title"><span>单机遥测 TELEMETRY</span></div>
        <div class="telemetry-body"></div>
      </div>
    `;
    root.appendChild(this.el);
    this.bodyEl = this.el.querySelector('.telemetry-body')!;
    this.renderEmpty();
  }

  private renderEmpty(): void {
    this.bodyEl.innerHTML = `<div class="telemetry-empty">点击场景中的无人机<br/>查看实时遥测数据</div>`;
  }

  select(drone: Drone | null): void {
    this.selectedDrone = drone;
    if (!drone) this.renderEmpty();
  }

  update(): void {
    const d = this.selectedDrone;
    if (!d) return;

    const typeColors = ['#2ce8f5', '#ffb02e', '#b44df0'];
    const color = typeColors[d.type];
    const speed = d.velocity.length();
    const batteryPct = Math.round(d.battery * 100);
    const batteryColor = d.battery > 0.4 ? '#3dff8a' : d.battery > 0.18 ? '#ffb02e' : '#ff3d55';
    const statusColor = d.status === DroneStatus.Failure ? '#ff3d55'
      : d.status === DroneStatus.Formation ? '#3dff8a' : '#c8dae8';

    this.bodyEl.innerHTML = `
      <div class="callsign-title" style="color:${color}">${d.callsign}</div>
      <div class="type-tag" style="color:${color}">${d.spec.name} · ${d.spec.nameZh}</div>
      <div class="tele-row"><span class="k">状态</span><span class="v" style="color:${statusColor}">${STATUS_LABEL_ZH[d.status]}</span></div>
      <div class="tele-row"><span class="k">高度 ALT</span><span class="v">${d.position.y.toFixed(1)} m</span></div>
      <div class="tele-row"><span class="k">速度 SPD</span><span class="v">${speed.toFixed(1)} m/s</span></div>
      <div class="tele-row"><span class="k">航向 HDG</span><span class="v">${((d.heading * 180 / Math.PI + 360) % 360).toFixed(0)}°</span></div>
      <div class="tele-row"><span class="k">坐标</span><span class="v">${d.position.x.toFixed(0)}, ${d.position.z.toFixed(0)}</span></div>
      <div class="tele-row"><span class="k">信号 SIG</span><span class="v">${Math.round(d.signal * 100)}%</span></div>
      <div class="tele-row" style="border:none"><span class="k">电量 BAT</span><span class="v" style="color:${batteryColor}">${batteryPct}%</span></div>
      <div class="battery-bar"><div class="fill" style="width:${batteryPct}%;background:${batteryColor};box-shadow:0 0 8px ${batteryColor}"></div></div>
    `;
  }
}
