#!/usr/bin/env node
/**
 * MCP Server (Model Context Protocol) para Creativos T-Shirt POS
 * Permite a agentes de IA (Gemini, Claude, GenSpark, Claw, Cursor, etc.)
 * interactuar en tiempo real con el inventario, pedidos y precios del sistema.
 */

import readline from 'node:readline';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDvEMiRNipixAZboMKxUYkKu_lGq9nzkcM",
  authDomain: "creativos-t-shirt.firebaseapp.com",
  projectId: "creativos-t-shirt",
  storageBucket: "creativos-t-shirt.firebasestorage.app",
  messagingSenderId: "1065069374241",
  appId: "1:1065069374241:web:cc9d56b971738ba316ac60"
};

function getDb() {
  const app = getApps().length > 0 ? getApp() : initializeApp(DEFAULT_FIREBASE_CONFIG);
  return getFirestore(app);
}

/** Lee el estado actual de la tienda desde Firestore */
async function fetchRemoteState() {
  const fs = getDb();
  const snap = await getDoc(doc(fs, 'cgs_sync', 'app_state'));
  if (!snap.exists()) {
    throw new Error('No se encontró el documento de sincronización app_state en Firestore');
  }
  const data = snap.data();
  if (!data?.payload) {
    throw new Error('El documento app_state no contiene el campo payload');
  }
  return data.payload;
}

/** Guarda el estado actualizado de la tienda en Firestore */
async function saveRemoteState(state) {
  const fs = getDb();
  const now = new Date().toISOString();
  const payload = {
    ...state,
    _by: 'mcp-agent-server',
    _at: Date.now()
  };
  await setDoc(doc(fs, 'cgs_sync', 'app_state'), {
    payload,
    updated_at: now
  });
  return true;
}

const TOOLS = [
  {
    name: 'get_inventory',
    description: 'Consulta el inventario actual de camisas en existencia, desglosado por marca, color y talla.',
    inputSchema: {
      type: 'object',
      properties: {
        brandName: { type: 'string', description: 'Nombre de la marca a filtrar (opcional)' },
        colorName: { type: 'string', description: 'Nombre del color a filtrar (opcional)' },
        size: { type: 'string', description: 'Talla a consultar (opcional, ej: M, L, XL)' }
      }
    }
  },
  {
    name: 'adjust_stock',
    description: 'Ajusta las existencias de una variante de camisa (agrega inventario entrante o registra mermas).',
    inputSchema: {
      type: 'object',
      properties: {
        brandName: { type: 'string', description: 'Nombre de la marca (ej: Camisa Clásica)' },
        colorName: { type: 'string', description: 'Nombre del color (ej: Negro, Blanco, Azul Royal)' },
        size: { type: 'string', description: 'Talla (ej: S, M, L, XL, 2XL)' },
        deltaQty: { type: 'number', description: 'Cantidad a sumar (positiva para entradas, negativa para salidas)' },
        reason: { type: 'string', description: 'Motivo del ajuste (ej: Compra de lote, Merma, Conteo físico)' }
      },
      required: ['brandName', 'colorName', 'size', 'deltaQty']
    }
  },
  {
    name: 'list_orders',
    description: 'Lista los pedidos registrados en el sistema, con filtros por estado o búsqueda por cliente.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'pending', 'production', 'ready', 'delivered', 'cancelled'],
          description: 'Filtrar por estado del pedido'
        },
        limit: { type: 'number', description: 'Límite máximo de resultados (por defecto 20)' }
      }
    }
  },
  {
    name: 'create_order',
    description: 'Registra una nueva venta o pedido de camisa lisa o personalizada en el sistema.',
    inputSchema: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'Nombre del cliente' },
        customerPhone: { type: 'string', description: 'Teléfono o WhatsApp del cliente' },
        customerAddress: { type: 'string', description: 'Dirección de entrega (opcional)' },
        brandName: { type: 'string', description: 'Marca de camisa' },
        colorName: { type: 'string', description: 'Color de la prenda' },
        size: { type: 'string', description: 'Talla de la prenda (ej: S, M, L, XL)' },
        qty: { type: 'number', description: 'Cantidad de camisas' },
        isCustom: { type: 'boolean', description: 'True si lleva diseño personalizado A3 (L 350), False si es Lisa (L 300)' },
        designName: { type: 'string', description: 'Nombre o descripción del estampado' },
        placement: { type: 'string', enum: ['front', 'back'], description: 'Lado del estampado (espalda o frente)' },
        notes: { type: 'string', description: 'Notas adicionales o instrucciones' }
      },
      required: ['customerName', 'colorName', 'size', 'qty']
    }
  },
  {
    name: 'update_order_status',
    description: 'Actualiza el estado de producción o entrega de un pedido existente.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Identificador del pedido' },
        newStatus: {
          type: 'string',
          enum: ['pending', 'production', 'ready', 'delivered', 'cancelled'],
          description: 'Nuevo estado del pedido'
        }
      },
      required: ['orderId', 'newStatus']
    }
  },
  {
    name: 'update_prices',
    description: 'Actualiza los precios base de la tienda (Camisa Lisa y Camisa Personalizada).',
    inputSchema: {
      type: 'object',
      properties: {
        priceNormal: { type: 'number', description: 'Precio de Camisa Lisa en centavos de Lempira (ej: 30000 para L 300.00)' },
        priceCustom: { type: 'number', description: 'Precio de Camisa Personalizada A3 en centavos de Lempira (ej: 35000 para L 350.00)' }
      }
    }
  }
];

async function handleToolCall(name, args) {
  const state = await fetchRemoteState();

  if (name === 'get_inventory') {
    const brands = (state.brands || []).filter((b) => !b.deleted);
    const colors = (state.colors || []).filter((c) => !c.deleted);
    const stockEntries = state.stock || {};

    const rows = [];
    for (const b of brands) {
      if (args.brandName && !b.name.toLowerCase().includes(args.brandName.toLowerCase())) continue;
      const brandColors = colors.filter((c) => c.brandId === b.id);
      for (const c of brandColors) {
        if (args.colorName && !c.name.toLowerCase().includes(args.colorName.toLowerCase())) continue;
        for (const sz of state.settings?.sizes || ['S', 'M', 'L', 'XL']) {
          if (args.size && sz.toUpperCase() !== args.size.toUpperCase()) continue;
          const k = `${b.id}__${c.id}__${sz}`;
          const count = stockEntries[k] || 0;
          rows.push({
            marca: b.name,
            color: c.name,
            hex: c.hex,
            talla: sz,
            existencias: count,
            estado: count > 0 ? 'Disponible' : 'Agotado / Bajo Pedido'
          });
        }
      }
    }
    return {
      totalVariantes: rows.length,
      resumen: rows
    };
  }

  if (name === 'adjust_stock') {
    const { brandName, colorName, size, deltaQty, reason } = args;
    const brand = (state.brands || []).find((b) => !b.deleted && b.name.toLowerCase() === brandName.toLowerCase()) || state.brands?.[0];
    if (!brand) throw new Error(`Marca no encontrada: ${brandName}`);

    const color = (state.colors || []).find((c) => !c.deleted && c.brandId === brand.id && c.name.toLowerCase() === colorName.toLowerCase());
    if (!color) throw new Error(`Color no encontrado: ${colorName} para marca ${brand.name}`);

    if (!state.stock) state.stock = {};
    const k = `${brand.id}__${color.id}__${size}`;
    const previous = state.stock[k] || 0;
    const next = Math.max(0, previous + deltaQty);
    state.stock[k] = next;

    if (!state.stockMovements) state.stockMovements = [];
    state.stockMovements.unshift({
      id: `mov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      brandId: brand.id,
      colorId: color.id,
      size,
      delta: deltaQty,
      previous,
      resulting: next,
      reason: reason || 'Ajuste vía agente MCP',
      createdAt: Date.now()
    });

    state.updatedAt = Date.now();
    await saveRemoteState(state);

    return {
      mensaje: `Stock actualizado con éxito`,
      variante: `${brand.name} · ${color.name} · Talla ${size}`,
      anterior: previous,
      cambio: deltaQty,
      actual: next,
      motivo: reason || 'Ajuste vía agente MCP'
    };
  }

  if (name === 'list_orders') {
    const orders = (state.orders || []).filter((o) => !o.deleted);
    let filtered = orders;
    if (args.status && args.status !== 'all') {
      filtered = filtered.filter((o) => o.status === args.status);
    }
    const limit = args.limit || 20;
    filtered = filtered.slice(0, limit);
    return {
      total: filtered.length,
      pedidos: filtered.map((o) => ({
        id: o.id,
        fecha: new Date(o.createdAt).toLocaleString(),
        cliente: o.customerName || 'Consumidor Final',
        telefono: o.customerPhone || 'N/A',
        totalLempiras: (o.total || 0) / 100,
        estado: o.status || 'pending',
        items: (o.items || []).map((it) => ({
          descripcion: it.description || 'Camisa',
          talla: it.size,
          color: it.colorName,
          cantidad: it.quantity,
          precioUnitario: (it.unitPrice || 0) / 100
        }))
      }))
    };
  }

  if (name === 'create_order') {
    const { customerName, customerPhone, customerAddress, brandName, colorName, size, qty, isCustom, designName, placement, notes } = args;
    const brand = (state.brands || []).find((b) => !b.deleted && (!brandName || b.name.toLowerCase() === brandName.toLowerCase())) || state.brands?.[0];
    const color = (state.colors || []).find((c) => !c.deleted && c.name.toLowerCase() === colorName.toLowerCase()) || { id: 'col_default', name: colorName, hex: '#1A1A1C' };

    const unitPrice = isCustom ? (state.settings?.priceCustom || 35000) : (state.settings?.priceNormal || 30000);
    const total = qty * unitPrice;
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const newOrder = {
      id: orderId,
      createdAt: Date.now(),
      status: 'pending',
      customerName: customerName.trim(),
      customerPhone: customerPhone ? customerPhone.trim() : '',
      customerAddress: customerAddress ? customerAddress.trim() : '',
      total,
      notes: notes || (isCustom ? `Personalizada A3: ${designName || 'Estampado'} (${placement || 'back'})` : 'Camisa Lisa'),
      items: [
        {
          id: `item_${Date.now()}`,
          brandId: brand?.id || 'b1',
          brandName: brand?.name || 'Camisa',
          colorId: color.id,
          colorName: color.name,
          colorHex: color.hex,
          size,
          quantity: qty,
          unitPrice,
          isCustom: !!isCustom,
          designName: designName || null,
          placement: placement || 'back'
        }
      ]
    };

    if (!state.orders) state.orders = [];
    state.orders.unshift(newOrder);

    // Descontar inventario si hay disponible
    if (brand && state.stock) {
      const k = `${brand.id}__${color.id}__${size}`;
      const current = state.stock[k] || 0;
      if (current >= qty) {
        state.stock[k] = current - qty;
      }
    }

    state.updatedAt = Date.now();
    await saveRemoteState(state);

    return {
      mensaje: '¡Pedido creado y registrado exitosamente en el sistema POS!',
      pedidoId: orderId,
      cliente: customerName,
      totalLempiras: total / 100,
      detalle: `${qty}x Camisa ${color.name} (Talla ${size}) - ${isCustom ? 'Personalizada A3 (L 350)' : 'Lisa (L 300)'}`
    };
  }

  if (name === 'update_order_status') {
    const { orderId, newStatus } = args;
    const order = (state.orders || []).find((o) => o.id === orderId);
    if (!order) throw new Error(`Pedido no encontrado: ${orderId}`);
    const oldStatus = order.status;
    order.status = newStatus;
    order.updatedAt = Date.now();

    state.updatedAt = Date.now();
    await saveRemoteState(state);

    return {
      mensaje: `Estado de pedido actualizado`,
      pedidoId: orderId,
      cliente: order.customerName,
      estadoAnterior: oldStatus,
      nuevoEstado: newStatus
    };
  }

  if (name === 'update_prices') {
    if (!state.settings) state.settings = {};
    if (args.priceNormal !== undefined) state.settings.priceNormal = args.priceNormal;
    if (args.priceCustom !== undefined) state.settings.priceCustom = args.priceCustom;
    state.updatedAt = Date.now();
    await saveRemoteState(state);

    return {
      mensaje: 'Precios actualizados en todo el sistema y en el catálogo público',
      precioLisaLempiras: (state.settings.priceNormal || 30000) / 100,
      precioPersonalizadaLempiras: (state.settings.priceCustom || 35000) / 100
    };
  }

  throw new Error(`Herramienta no implementada: ${name}`);
}

// Inicializar interfaz de comunicación JSON-RPC estándar sobre stdio
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (err) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  const { id, method, params } = request;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'creativos-pos-mcp',
          version: '1.0.0'
        }
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS
      }
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    try {
      const output = await handleToolCall(name, args || {});
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2)
            }
          ]
        }
      });
    } catch (err) {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error ejecutando ${name}: ${err.message}`
            }
          ]
        }
      });
    }
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  }
});
