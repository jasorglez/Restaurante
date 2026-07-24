import { Component, inject, signal } from '@angular/core';
import { RealtimeService } from '../../core/realtime.service';

/**
 * Chip de aviso + modal de diagnóstico cuando el socket de avisos en tiempo
 * real (SignalR) no logra conectar. Totalmente autocontenido — se monta
 * siempre en el topbar de App, junto a los demás chips de estado.
 */
@Component({
  selector: 'app-realtime-debug',
  templateUrl: './realtime-debug.html',
  styleUrl: './realtime-debug.scss',
})
export class RealtimeDebug {
  protected readonly realtimeSvc = inject(RealtimeService);
  protected readonly mostrarDebug = signal(false);
}
