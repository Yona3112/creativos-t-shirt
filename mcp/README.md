# Creativos T-Shirt POS · Servidor MCP Oficial

Este servidor implementa el protocolo abierto **Model Context Protocol (MCP)** para permitir que agentes inteligentes como **Gemini, Claude, GenSpark, Claw, Cursor u OpenDevin** consulten y operen el sistema en tiempo real.

---

## 🛠️ Herramientas Disponibles para los Agentes

1. **`get_inventory`**: Consulta en tiempo real las existencias de camisas por marca, color y talla.
2. **`adjust_stock`**: Registra entradas de mercadería nueva o descuenta mermas con motivo.
3. **`create_order`**: Crea un nuevo pedido o venta en el sistema POS con cálculo automático de precio (Lisa L 300 o Personalizada A3 L 350).
4. **`list_orders`**: Lista pedidos filtrados por estado (`pending`, `production`, `ready`, `delivered`, `cancelled`).
5. **`update_order_status`**: Cambia el estado del pedido (ej. de pendiente a producción o entregado).
6. **`update_prices`**: Modifica los precios base del catálogo y del punto de venta.

---

## 🚀 Cómo Conectar a Clientes MCP

### 1. Claude Desktop (`claude_desktop_config.json`)
Añade en tu archivo de configuración de Claude Desktop:
```json
{
  "mcpServers": {
    "creativos-pos": {
      "command": "node",
      "args": [
        "c:/Users/DELL/Downloads/creativos-gift-pos/creativos-t-shirt/mcp/server.mjs"
      ]
    }
  }
}
```

### 2. Cursor IDE (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "creativos-pos": {
      "command": "node",
      "args": ["c:/Users/DELL/Downloads/creativos-gift-pos/creativos-t-shirt/mcp/server.mjs"]
    }
  }
}
```

### 3. Gemini CLI / Antigravity / Claw / GenSpark
Ejecutar con el transporte estándar `stdio`:
```bash
node c:/Users/DELL/Downloads/creativos-gift-pos/creativos-t-shirt/mcp/server.mjs
```

---

## 🧪 Prueba Rápida
Puedes probar el servidor en la terminal enviando un mensaje JSON-RPC:
```bash
echo {"jsonrpc":"2.0","id":1,"method":"tools/list"} | node mcp/server.mjs
```
