# Drekee AI 1.5 Pro - Implementation Notes

## Overview
Drekee AI 1.5 Pro is a scientific reasoning agent with real NASA media integration. The system features a non-generic UI that displays reasoning logs, AI responses, and NASA images/videos when enabled.

## Architecture

### Frontend (`index.html`)
- **Vanilla JavaScript** - No frameworks, lightweight
- **Real-time rendering** - Sequential animation of logs → response → media
- **NASA Toggle** - Button to enable/disable NASA media searches
- **Chat History** - localStorage persistence across sessions
- **Responsive Design** - Dark theme with scientific aesthetic

### Backend (`api/chat.js`)
- **Node.js/Vercel serverless** handler
- **Three-step pipeline**:
  1. Generate action plan (internal, not shown to user)
  2. Execute reasoning and research (Tavily web search + optional NASA media)
  3. Review with Gemini for validation and factual accuracy
- **Returns**: `{ response, logs, media }`

### APIs Used
- **Groq** (LLaMA 3.3 70B) - Main reasoning
- **Gemini 2.5 Flash** - Response review/validation
- **Tavily** - Web search for context
- **NASA Image/Video Library** - Media search (public API, no key needed)

## Key Features

### ✅ Reasoning Logs
- Displayed sequentially as messages appear
- Shows progress: searching, processing, validating
- Prefixed with relevant emojis for clarity

### ✅ NASA Media Integration
- Toggle button in input toolbar (🚀 icon)
- When enabled: searches NASA for images/videos related to query
- Displays media grid with titles, descriptions, and full-resolution links
- Supports both static images and videos

### ✅ No Plan Display
- The action plan is generated internally for the agent's reasoning
- Users **never** see the plan structure in the UI
- Only receives: reasoning logs, final response, and media

### ✅ Clean Response
- Main AI response displays without metadata
- Confidence tags removed from user view
- Logs and media are optional sections below response

## File Structure
```
/workspaces/drekee-1.5-pro/
├── index.html          # Frontend (styling + JavaScript)
├── api/chat.js         # Backend handler
├── README.md
└── IMPLEMENTATION_NOTES.md (this file)
```

## Environment Variables Required

```env
GROQ_API_KEY_1=<main-reasoning-model>
GROQ_API_KEY_2=<planning-model>
GEMINI_API_KEY=<review-model>
TAVILY_API_KEY=<web-search>
```

## Running Locally

### With Vercel CLI
```bash
vercel dev
```
This will start a local server at `http://localhost:3000/`

### Manual Setup
```bash
npm install  # if package.json exists
node -c api/chat.js  # validate syntax
# Deploy to Vercel or setup local Node server
```

## How to Use

1. **Start conversation**: Type in the input field and press Enter
2. **Enable NASA mode**: Click the 🚀 button before sending to include NASA media
3. **View reasoning**: Logs appear sequentially above the response
4. **Access media**: NASA images/videos appear in grid below response

## Response Structure

When the API is called with `nasa: true`:

```json
{
  "response": "The main AI response text...",
  "logs": [
    "🚀 Iniciando Agente Científico...",
    "🌐 Buscando na web (Tavily)...",
    "✅ Dados da web coletados",
    "🚀 Buscando mídia da NASA...",
    "✅ Dados da NASA coletados",
    "👁️ Revisando resposta com Gemini...",
    "✅ Resposta revisada e validada"
  ],
  "media": [
    {
      "title": "Image Title",
      "description": "Image description",
      "date": "2024-01-15",
      "url": "https://...",
      "media_type": "image"
    }
  ]
}
```

## Frontend Rendering Flow

1. **User submits**: `sendMessage()` sends payload to `/api/chat`
2. **Thinking indicator**: Shows loading state
3. **Sequential rendering**: `renderAgentSequence()` animates:
   - Logs appear one by one (250ms delay each)
   - Response appears after logs
   - Media grid renders after response
4. **Completion**: Chat ready for next input

## Validation Status

✅ Backend syntax validated with `node -c api/chat.js`
✅ Frontend functions present: async, renderAgentSequence, nasaEnabled, sendMessage
✅ CSS styles: media-grid, thinking-logs, ai-response all defined
✅ No deprecated plan/confidence references in responses

## Future Enhancements

- [ ] File upload processing (serialized but not yet processed)
- [ ] Voice input/output
- [ ] Link citations for web search results
- [ ] Advanced search filters (date, provider)
- [ ] Export conversation as PDF
- [ ] Multi-language support

## Troubleshooting

**Q: NASA media not appearing?**
- Check if NASA toggle was enabled before sending
- Verify NASA API is accessible (public endpoint, usually stable)
- Check browser console for network errors

**Q: Reasoning logs empty?**
- API should return logs array even on errors
- Check server response in browser DevTools Network tab

**Q: Response shows [CONFIANÇA: ALTO/MÉDIO/BAIXO]?**
- This tag should be stripped by Gemini review
- Check backend response handling in `api/chat.js`

## Technical Debt

- File attachment UI is prepared but not yet processed server-side
- Could add streaming for faster log display
- Could cache NASA searches for same queries within session

---

**Last Updated**: 2024-03-19
**Status**: Ready for deployment
