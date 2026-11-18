// Pruebas que no necesitan tus datos: corren en cada PR (GitHub Actions) y también dentro de tests.html.
// Devuelve [nombre, fn] como las asincrónicas de js/pruebas.js.
import { tickersPropios, esRespaldoPlano } from './estado.js';
import { deflactor, rendimiento, xirr, curvaPorcentual } from './finanzas.js';
import { proximosFlujos } from './motor.js';
import { derivarClave, cifrar, descifrar, esSobreCifrado } from './cripto.js';

const cerca = (a, b, tol, que) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${que}: dio ${a}, esperado ≈ ${b}`); };

export function pruebasPublicas() {
  return [
    ['Radar: una acción local se reconoce por su ADR (PAMP → PAM) y el bloque YPF por YPF', async () => {
      const m = tickersPropios([
        { ticker: 'PAMP', subyacente: 'PAMP', grupo: 'satelite' },
        { ticker: 'YM43O', grupo: 'ypf', bloque: 'satelite_ypf' },
        { ticker: 'SPY', subyacente: 'SPY', grupo: 'nucleo' },
      ]);
      if (m.get('PAM') !== 'PAMP') throw new Error('PAM no apunta a PAMP');
      if (m.get('YPF') !== 'YM43O') throw new Error('YPF no apunta a la ON');
      if (m.get('SPY') !== 'SPY' || m.has('GGAL')) throw new Error('marca de más o de menos');
    }],

    ['Inflación: el deflactor lleva cada mes a dólares del último IPC', async () => {
      const d = deflactor({ '2025-01': 100, '2025-06': 102, '2026-01': 103 });
      cerca(d.factor('2025-01-15'), 1.03, 1e-9, 'enero 2025');
      cerca(d.factor('2025-03-10'), 1.03, 1e-9, 'mes sin dato usa el anterior');
      cerca(d.factor('2026-05-01'), 1, 1e-9, 'posterior al último dato');
      if (deflactor({ '2025-01': 100 }) !== null) throw new Error('con un solo mes no debería deflactar');
    }],

    ['Rendimiento real: 100 → 110 en un año con 3% de inflación ≈ 6,8% real', async () => {
      const estado = {
        hoy: '2026-01-01', total_usd: 110,
        datos: { cashflows_externos_usd: [{ fecha: '2025-01-01', usd: 100 }], nucleo: { pesos_internos: { SPY: 1 } } },
        mercado: { cpi_usa: { meses: { '2025-01': 100, '2026-01': 103 } } }, historico: null,
      };
      const r = rendimiento(estado);
      cerca(r.cartera.xirr, 0.1, 0.001, 'nominal');
      cerca(r.cartera.xirr_real, 1.10 / 1.03 - 1, 0.001, 'real');
      cerca(r.inflacion.acumulada, 0.03, 1e-9, 'inflación acumulada');
      const sin = rendimiento({ ...estado, mercado: null });
      if (sin.cartera.xirr_real !== null || sin.inflacion !== null) throw new Error('sin IPC debería quedar vacío');
      cerca(xirr([{ fecha: '2025-01-01', monto: -100 }, { fecha: '2026-01-01', monto: 110 }]), 0.1, 0.001, 'xirr');
    }],

    ['Evolución en %: un aporte no cuenta como ganancia', async () => {
      // 100 → 110 (+10%) → aporta 50 y queda en 176: ganó 16 sobre 110 (+14,5%). Acumulado ≈ 26%, no 76%.
      const diario = [{ f: '2026-01-01', v: 100 }, { f: '2026-01-02', v: 110 }, { f: '2026-01-03', v: 176 }];
      const c = curvaPorcentual(diario, [{ fecha: '2026-01-03', usd: 50 }, { fecha: '2025-12-01', usd: 100 }]);
      cerca(c[0], 0, 1e-12, 'arranca en 0');
      cerca(c[1], 0.10, 1e-12, 'primer tramo');
      cerca(c[2], 1.1 * (1 + 16 / 110) - 1, 1e-9, 'acumulado con aporte el último día');
      // Varios días sin abrir: el aporte del principio del tramo se cuenta como invertido casi todo el tramo.
      const hueco = [{ f: '2026-01-01', v: 100 }, { f: '2026-01-31', v: 165 }];
      const h = curvaPorcentual(hueco, [{ fecha: '2026-01-01', usd: 0 }, { fecha: '2026-01-02', usd: 50 }]);
      cerca(h[1], 15 / (100 + 50 * 29 / 30), 1e-9, 'Dietz modificado');
    }],

    ['Vencimientos: lista lo próximo y lo vencido sin registrar, no lo ya cobrado', async () => {
      const e = {
        hoy: '2027-03-01',
        posiciones: [{ ticker: 'ON1', cantidad: 1000 }],
        datos: { cobros: [{ ref: 'ON1-2027-01-14-cupon' }] },
        calendario: { flujos: [
          { ticker: 'ON1', fecha: '2026-07-14', tipo: 'cupon', por_vn: 0.02 },
          { ticker: 'ON1', fecha: '2027-01-14', tipo: 'cupon', por_vn: 0.04 },
          { ticker: 'ON1', fecha: '2027-07-14', tipo: 'cupon', por_vn: 0.03 },
          { ticker: 'OTRA', fecha: '2027-07-14', tipo: 'cupon', por_vn: 1 },
        ] },
      };
      const f = proximosFlujos(e);
      if (f.length !== 2) throw new Error(`esperaba 2, hay ${f.length}`);
      if (!f[0].vencido || f[0].fecha !== '2026-07-14') throw new Error('falta el vencido sin registrar');
      cerca(f[1].usd, 30, 1e-9, 'monto del próximo');
    }],

    ['Respaldo cifrado: ida y vuelta, y se distingue del respaldo sin cifrar', async () => {
      const datos = { posiciones: [], reglas: [], meta: { x: 1 }, nucleo: {} };
      const salt = btoa('sal-de-prueba-16b');
      const clave = await derivarClave('una frase de prueba bastante larga', salt, 1000);
      const sobre = await cifrar(datos, clave, salt, 1000);
      if (!esSobreCifrado(sobre) || esRespaldoPlano(sobre)) throw new Error('el sobre no se reconoce');
      if (!esRespaldoPlano(datos) || esSobreCifrado(datos)) throw new Error('el plano no se reconoce');
      const vuelta = await descifrar(sobre, clave);
      if (JSON.stringify(vuelta) !== JSON.stringify(datos)) throw new Error('no volvió igual');
      const otra = await derivarClave('otra frase distinta y también larga', salt, 1000);
      let abrio = true;
      try { await descifrar(sobre, otra); } catch { abrio = false; }
      if (abrio) throw new Error('abrió con otra clave');
    }],
  ];
}
