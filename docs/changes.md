# docs/changes.md â€?æ”¹åŠ¨æ¸…å•ï¼ˆzip åˆ†å‘ä¸Žåº•åº§å‡çº§è¿ç§»ä¾æ®ï¼‰

> åº•åº§ï¼šVibe-Research v1.2.0ï¼ˆcommit å¿«ç…§ï¼?026-09 ä¸‹è½½çš?main åˆ†æ”¯ zipï¼?14 æ–‡ä»¶ï¼?> æ”¹é€ ï¼šèµ„é‡‘é›·è¾¾å·¥ä½œå?å››åˆ€ï¼ˆåˆ€1-4ï¼?> ç»´æŠ¤ï¼šæž¶æž„å¸ˆ

## æ–°å¢žæ–‡ä»¶ï¼ˆè‡ªæœ‰ä»£ç ï¼‰

| æ–‡ä»¶ | å†…å®¹ | åˆ€ |
|---|---|---|
| calc/fundradar.py + tests/ | 4 å‡½æ•°ï¼šheat_score/zscore20/pnl/anomaly_judgeï¼?6/96 å•æµ‹ï¼?| 2 |
| .agents/skills/fundradar-{persona,mainline-radar,morning-report,qa-intents,anomaly-sentinel,voice-ui}/SKILL.md | 6 ä¸ªèµ„é‡‘é›·è¾?skill | 2 |
| desktop/src/verticals/finance/fundradar-theme.css | ä¸‰æ¡£å­—å·/çº¢æ¶¨ç»¿è·Œ/çŽ»ç’ƒå?æ·±æµ…é¡?å¸­ä½å››è‰² | 3 |
| desktop/src/verticals/finance/lib/fundradarTheme.ts | å­—å·æ¡£ä½è¯»å†™ | 3 |
| desktop/src/verticals/finance/data/fundradarSample.ts | ç¤ºä¾‹æ•°æ®ï¼ˆTODO: æŽ¥çœŸå®žæ•°æ®ï¼‰ | 3 |
| desktop/src/verticals/finance/pages/Fundradar{Home,AgentChat,Radar,DailyReview,Lhb,Portfolio,Settings,Skills}.tsx | ä¸ƒé¡µ+æŠ€èƒ½ä¸­å¿ƒå ä½?| 3 |
| desktop/src/verticals/finance/components/fundradar/{VoiceInput.tsx,useSpeech.ts} | Web è¯­éŸ³è¾“å…¥/æœ—è¯» | 4 |
| å¯åŠ¨èµ„é‡‘é›·è¾¾.ps1 / .bat | å®¶äººä¸€é”®å¯åŠ¨ï¼ˆå?token ç»•è¿‡ï¼?| 4 |
| orchestrator/pnpm-workspace.yamlã€desktop/pnpm-workspace.yamlã€é”æ–‡ä»¶ | pnpm éƒ¨ç½²é…ç½® | 1 |

## æ”¹é€ æ–‡ä»¶ï¼ˆä¸Šæ¸¸æ–‡ä»¶è¢«ä¿®æ”¹å¤„ï¼?
| æ–‡ä»¶ | æ”¹åŠ¨ | åˆ€ |
|---|---|---|
| AGENTS.md | æœ«å°¾è¿½åŠ  FUNDRADAR æ ‡è®°å—ï¼ˆä¸Šæ¸¸æ­£æ–‡é›¶æ”¹åŠ¨ï¼Œå­—èŠ‚çº§éªŒè¯ï¼‰ | 2 |
| providers/deepseek.json | default_model: deepseek-v4-flash â†?deepseek-flashï¼? è¡Œï¼‰ | 1 |
| desktop/src/verticals/finance/components/layout/Layout.tsx | ä¾§æ åŒåŒº + åº•éƒ¨å¼€å…?| 3 |
| desktop/src/verticals/finance/router.tsx | ä¸ƒé¡µæŒ‚è½½ï¼›åº•åº§ä¸‰é¡µæ”¹æŒ?/daily-review-advã€?portfolio-manageã€?settings-ai | 3 |
| desktop/src/main.tsx | å¼•å…¥ fundradar-theme.cssï¼? è¡Œï¼‰ | 3 |
| desktop/src/hooks/useDarkMode.ts | é€‚è€é¡µæµ…è‰²é»˜è®¤ã€æ·±è‰²ä¸‰é¡µå›ºå®?| 4 |
| orchestrator/src/api.ts | ÐÂÔö GET /fetch-raw Ö»¶ÁÂ·ÓÉ£º×Ê½ðÀ×´ï KÏß/×Ê½ðÐòÁÐÐèÒª£»°×Ãûµ¥+¼øÈ¨+NOFOLLOW£»ÉÏÓÎÉý¼¶¶ÔÕÕÇ¨ÒÆ | 6 |
| orchestrator/src/validator.ts | ·Å¿í percentile_rank ÐòÁÐÊµ²Î°ó¶¨¼ì²é£ºDeepSeek ÄÚÁªÐòÁÐµ« calc ½á¹ûÕýÈ·Ê±½ÓÊÜ£¨Ô­ÒªÇó±ØÐë°ó¶¨ raw ÎÄ¼þ£©£¬±ÜÃâ¹ÀÖµ½×¶ÎÎó±ê failed | 7 |

## å·²çŸ¥é—®é¢˜ï¼ˆåº•åº§æ ¹å› ï¼ŒæœªåŠ¨ç¦åŒºï¼?
1. **api.token äºŒæ¬¡æ”¶ç´§å¤±è´¥**ï¼šorchestrator/src/fsutil.ts çš?restrictPrivateFile åœ¨éžææƒè¿›ç¨‹ä¸‹å¯¹å·²æ”¶ç´§æ–‡ä»¶å†æ¬?Set-Acl æŠ?PrivilegeNotHeldException â†?API exit 1ã€?*ç»•è¡Œ**ï¼šå¯åŠ¨è„šæœ¬å…ˆåˆ æ—§ tokenï¼ˆAPI é‡æ–°ç”Ÿæˆï¼‰ã€‚åº•åº§å‡çº§åŽéœ€åœ¨åº•åº§ä¾§ä¿®å¤ï¼ˆå¹‚ç­‰è·³è¿‡æˆ–å…ˆåˆ åŽå»ºï¼‰ã€?2. æœ¬æœºæ—?npmï¼šå®˜æ–?setup-windows.cmd/start.ps1 ä¸å¯ç”¨ï¼›ç”?å¯åŠ¨èµ„é‡‘é›·è¾¾.bat"ã€?3. @types/mdast æ ¹é“¾æŽ¥ç¼ºå¤±ï¼ˆçŽ¯å¢ƒé—®é¢˜ï¼Œå·²ç”?junction ä¿®å¤ï¼‰ã€?
## å¾…åŠžï¼ˆäº§å“æµ‹è¯•é˜¶æ®µåŽï¼?
- [ ] ç¤ºä¾‹æ•°æ®ï¼ˆfundradarSample.tsï¼‰â†’ æŽ¥çœŸå®žæ•°æ®ç«¯ç‚¹ï¼ˆrss_news/em_* ç³»åˆ—ï¼?- [ ] æ™¨æŠ¥å†…å®¹æ”¹ä¸º AI ç”Ÿæˆï¼ˆå½“å‰ä¸ºç¤ºä¾‹æ–‡æœ¬ + åº•åº§ morning_strategy å¾…æŽ¥ï¼?- [ ] SenseVoice æœ¬åœ°ç¦»çº¿è¯­éŸ³ï¼ˆP2 å¢žå¼ºï¼Œå½“å‰ä¸ºæµè§ˆå™?Web Speech APIï¼?- [ ] æ·±æµ…æ¨¡å¼ç»†èŠ‚æ‰“ç£¨ï¼ˆé€‚è€é¡µæµ…è‰²ä¸ºé»˜è®¤ï¼Œæ·±è‰²ä¸‰é¡µå›ºå®šï¼?

## ¶Ô»° Agent ÌåÑéÖØ¹¹£¨µ¶6 ¡¤ Í³Ò» Agent Ä£Ê½£©

Ä¿±ê£º¶Ô»°Ò³Ä¬ÈÏ Agent Ä£Ê½¡¢×Ê½ðÀ×´ïÀÏ»ï¼ÆÈËÉè + Êý¾Ý¹¤¾ßÕæÊµÉúÐ§¡¢Á÷Ê½Êä³ö + ¹¤¾ß½ø¶È¿É¼û¡¢¼òµ¥Êý¾ÝÎÊÌâ¿ìËÙÓ¦´ð¡£

¸ÄÔìÎÄ¼þ£¨orchestrator£©£º
- orchestrator/src/chat.ts£ºÐÂÔö ChatStreamEvent ÀàÐÍ£¬chatSend Ôö¼Ó onEvent Á÷Ê½»Øµ÷£¨ÕýÎÄÀÛ¼Æ + ¹¤¾ß started/completed/failed£©¡£
- orchestrator/src/assistant_turn.ts£º¶Ô»° system prompt ÏÔÊ½×¢Èë fundradar-persona Óë qa-intents È«ÎÄ£¨È¥ frontmatter£©+¡¸Êý×Ö±ØÐëÀ´×Ô¹¤¾ß·µ»Ø¡¹+¡¸µ¥µãÊý¾ÝÎÊÌâµ÷ 1-2 ¸ö¹¤¾ß¿ì´ð¡¹¼ÍÂÉ¡£
- orchestrator/src/service.ts£ºchatSend Í¸´« onEvent£¬agent Â·¾¶°ÑÁ÷Ê½»Øµ÷½Óµ½ assistantTurn¡£
- orchestrator/src/api.ts£º/chat Ö§³Ö stream:true µÄ SSE Êä³ö£¨text/tool/done/error ÊÂ¼þ£©¡£

¸ÄÔìÎÄ¼þ£¨desktop£©£º
- desktop/src/verticals/finance/lib/llmStore.ts£ºexecutionMode Ä¬ÈÏ agent£¨ÏÔÊ½ direct ²Å¹Ø£©£»ÐÂÁ¬½ÓÄ¬ÈÏ agent¡£
- desktop/src/verticals/finance/lib/backend.ts£ºÐÂÔö chatStream£¨SSE ¶ÁÈ¡£©+ ChatResult/ChatStreamEvent ÀàÐÍ¡£
- desktop/src/core/ai/useAiChat.ts£ºAiSend Ö§³Ö onProgress£¬Á÷Ê½ÆÚ¼äÖð¶Î patch ×îºóÆøÅÝ¡£
- desktop/src/verticals/finance/pages/FundradarAgentChat.tsx£º×ß chatStream£»ÆøÅÝÔ²½Ç¶ÔÆëµ××ù£»¿Õ»Ø´ðÏÔÊ¾ spinner£»¹ý³¤»Ø´ðÕÛµþ¡¸Õ¹¿ªÈ«ÎÄ¡¹£»¹¤¾ß½ø¶ÈÊµÊ±Õ¹Ê¾¡£

ÑéÖ¤£º
- desktop build£¨tsc 0 ´íÎó + vite build£©Í¨¹ý£»orchestrator tsc --noEmit Í¨¹ý¡£
- Êµ²â£¨ÎÞ AI key »·¾³£©£º/chat Á÷Ê½ SSE Í· + data Ö¡ + error ÊÂ¼þÕý³££»em_zt_pool ÕæÊµÈ¡Êý 52 ¼ÒÕÇÍ££¨2026-09-26£©¡£
- ÍêÕû¡¸½ñÌìÄÄ¸ö·½Ïò×îÇ¿¡¹¶Ô»°Ðèä¯ÀÀÆ÷²àÒÑ½ÓÈëµÄ AI key£¨±¾»úºó¶ËÄ¬ÈÏ openai Î´µÇÂ¼£©¡£
## ¸ö¹ÉËÙÀÀ±¨¸æ£¨µ¶7 ¡¤ ËÄµã±¨¸æ + ÕªÒªÕ¹¿ª£©

Ä¿±ê£º½â¾ö¡¸XX Ê²Ã´Çé¿ö¡¹Ö»¸øÐÐÇé+ÐÂÎÅÇ³²ãÎÊ´ð£»ÐÂÔö½á¹¹»¯ËÄµã±¨¸æ£¨Ç÷ÊÆ > ·çÏÕ > Ç°¾° > ¼¾±¨£¬¸½¹ÀÖµ£©£¬ÕªÒª²ãÃë¼¶ËÄµã + ÍêÕû²ãÕ¹¿ª + ÉîÑÐ²ã×ßµ××ùÁù½×¶Î¡£

ÐÂÔöÎÄ¼þ£¨×ÔÓÐ´úÂë£©£º
| ÎÄ¼þ | ÄÚÈÝ | µ¶ |
|---|---|---|
| calc/fundradar.py£¨ÐÂÔöº¯Êý£© | range_return(closes, n)£º½ü n ÈÕÇø¼äÕÇµø·ù%((Ä©Öµ/Ê×Öµ-1)*100£¬±£Áô2Î»)£»Òì³£Óò len<n »òÊ×Öµ¡Ü0 ¡ú not_meaningful | 7 |
| calc/tests/fixtures/fundradar_cases.json + calc/tests/test_fundradar.py | range_return 19 Ìõ fixture + 1 ÏÔÊ½µ¥²â + 2 ¼«¶ËÌ½Õë | 7 |
| .agents/skills/fundradar-stock-brief/SKILL.md | ËÄµã SOP + Èý²ã´¥·¢£¨Ä¬ÈÏÕªÒª²ã/¿´ÍêÕû¡úÍêÕû²ã/Éî¶ÈÑÐ¾¿¡úÉîÑÐ²ã£©+ Êý¾ÝÔ´Ó³Éä + ¼ÍÂÉ + ÕªÒª²ãÊä³öÄ£°å | 7 |

¸ÄÔìÎÄ¼þ£¨ÉÏÓÎÎÄ¼þ±»ÐÞ¸Ä´¦£©£º
| ÎÄ¼þ | ¸Ä¶¯ | µ¶ |
|---|---|---|
| orchestrator/src/assistant_turn.ts | agentDeveloperInstructions ²¢ÁÐ×¢Èë fundradar-stock-brief SKILL.md ÕýÎÄ£¨Óë persona/qa-intents Í¬Ò» readSkillBody ·½Ê½£© | 7 |
| desktop/src/verticals/finance/pages/FundradarAgentChat.tsx | AssistantBody Ê¶±ðËÄµã±¨¸æ£¨Ç÷ÊÆ/·çÏÕ/Ç°¾°/¼¾±¨ ¡Ý3 ´Ê£©Ê±ÕÛµþÏÔÊ¾¡¸ÕªÒª¡¹+¡¸¿´ÍêÕû±¨¸æ¡¹£»ÆäÓà¹ý³¤»Ø´ðÈÔ¡¸Õ¹¿ªÈ«ÎÄ¡¹£»ÀÊ¶Á¶ÁÈ«ÎÄ¡¢Á÷Ê½²»ÕÛµþ²»ÊÜÓ°Ïì | 7 |

ÑéÖ¤£º
- calc µ¥²â£ºcalc/tests/test_fundradar.py 118 passed£»calc/tests/ È«Á¿ 328 passed¡¢13 failed£¨¾ùÎª¼ÈÓÐ»·¾³ÎÊÌâ£ºCLI ×Ó½ø³Ì GBK/UTF-8 ½âÂë¡¢Windows symlink ÌØÈ¨ WinError 1314£¬·Ç±¾´Î¸Ä¶¯ÒýÈë£©¡£
- desktop build£ºtsc 0 ´íÎó + vite build Í¨¹ý£»orchestrator typecheck£ºtsc --noEmit 0 ´íÎó¡£
orchestrator/src/api.ts ÐÂÔö GET /global-index Ö»¶Á´úÀíÂ·ÓÉ

## ¶Ô»°¹¤¾ß¿¨»Ø´«Èë²Î/½á¹ûÕýÎÄ£¨µ¶8£©

Ä¿±ê£º¶Ô»°Á÷´ËÇ°Ö»»Ø´«¹¤¾ßÃû/×´Ì¬/ºÄÊ±£¬¹¤¾ß¿¨Õ¹¿ª¿´²»µ½Èë²ÎÓë½á¹û¡£²¹ÉÏÈë²ÎÕªÒªÓë½á¹ûÕªÒª£¬Ëæ tool ÊÂ¼þÓë tool_activity »Ø´«£¬Ç°¶Ë¹¤¾ß¿¨Õ¹¿ªÏÔÊ¾ÕæÊµÕªÒª£»È±Ê§ÈÔ³ÏÊµ±ê×¢¡£

ÐÂÔöÎÄ¼þ£¨×ÔÓÐ´úÂë£©£º
| ÎÄ¼þ | ÄÚÈÝ | µ¶ |
|---|---|---|
| orchestrator/src/tool_summary.ts | summarizeToolArgs/summarizeToolResult£º°Ñ¹¤¾ßÈë²Î/½á¹û¸÷Ñ¹³É 200 ×ÖÄÚÕªÒª£»½á¹ûÓÅÏÈÈ¡ evidence µÄ field: value unit | 8 |

¸ÄÔìÎÄ¼þ£¨ÉÏÓÎÎÄ¼þ±»ÐÞ¸Ä´¦£©£º
| ÎÄ¼þ | ¸Ä¶¯ | µ¶ |
|---|---|---|
| orchestrator/src/chat.ts | ChatStreamEvent µÄ tool ÊÂ¼þÔö¼Ó args/result ×Ö¶Î£»mcp_tool_call ¿ªÊ¼Ê±»Ø´«Èë²ÎÕªÒª¡¢½áÊøÊ±»Ø´«½á¹ûÕªÒª£¨´Ó MCP ·µ»Ø text ¿é½âÎö£© | 8 |
| orchestrator/src/assistant_bridge.ts | ToolReceipt Ôö¼Ó args_summary/result_summary ×Ö¶Î£¨bridge receipt ¶µµ×£¬×îÖÕ tool_activity ´ø»Ø£© | 8 |
| desktop/src/verticals/finance/lib/backend.ts | ChatResult.tool_activity / ChatStreamEvent ¶ÔÆëÐÂ×Ö¶Î£»chatStream SSE ½âÎöÍ¸´« args/result | 8 |
| desktop/src/verticals/finance/pages/FundradarAgentChat.tsx | ToolRecord Ôö¼Ó args/result£»sendTurn/splitTools Í¸´«£»¹¤¾ß¿¨Õ¹¿ªÏÔÊ¾¡¸Èë²Î/½á¹û¡¹£¬È±Ê§³ÏÊµ±ê×¢¡¸Î´»Ø´«/Î´·µ»Ø½á¹û¡¹ | 8 |
| desktop/src/verticals/finance/fundradar-theme.css | Ôö¼Ó .fr-tool-empty Õ¼Î»ÑùÊ½ | 8 |

À´Ô´Óë×Ö¶Î½á¹¹£º
- Èë²Î/½á¹ûÕªÒªÀ´Ô´£ºCodex mcp_tool_call ÊÂ¼þµÄ arguments Óë result£¨MCP ·µ»ØµÄ text ¿é = ¹¤¾ß½á¹û JSON£©Ö±½ÓÌáÈ¡£»bridge receipt£¨tool_activity£©Í¬²½²¹ args_summary/result_summary ¶µµ×¡£
- »Ø´«×Ö¶Î£ºtool ÊÂ¼þ { type:"tool", name, status, args?, result? }£»tool_activity { name, ok, duration_ms, args_summary?, result_summary? }¡£
- ½á¹ûÕªÒªÈ¡ evidence µÄ field: value unit£¬½Ø¶Ï 200 ×Ö£»Ê§°Ü/È±Ê§·µ»Ø¿Õ´®£¬Ç°¶Ë±ê×¢¡¸Î´»Ø´«/Ê§°Ü£¬ÎÞ½á¹û¡¹£¬²»±àÔì¡£

ÑéÖ¤£º
- orchestrator typecheck£¨tsc --noEmit£©0 ´íÎó£»desktop build£¨tsc 0 ´íÎó + vite build£©Í¨¹ý¡£

## Áú»¢°ñ½»Ò×Ëù¹Ù·½±¸Ô´ + akshare ËÄÎ¬×Ê½ð£¨µ¶9£©

Ä¿±ê£º¢Ù ¶«²Æ em_daily_dragon_tiger ±»·âÊ±½µ¼¶µ½ÉÏ½»Ëù/Éî½»Ëù¹Ù·½Áú»¢°ñ£¨Áã¼øÈ¨£¬º¬ÓªÒµ²¿Ï¯Î»£©£»¢Ú ÓÃ akshare stock_individual_fund_flow ²¹¸ö¹É 120 ÈÕËÄÎ¬×Ê½ð£¨Ö÷Á¦/³¬´óµ¥/´óµ¥/ÖÐµ¥/Ð¡µ¥£©£¬¶«²Æ push2his ¶ÏÁ¬Ê±¶àÒ»ÌõÖ±Á¬Â·¾¶¡£

Êµ²â½áÂÛ£¨2026-09-28£©£º
- ½»Ò×Ëù¹Ù·½Áú»¢°ñ¿ÉÓÃ£ºÉî½»Ëù ShowReport(CATALOGID=1842_xxpl) ·µ»Ø½á¹¹»¯ 32 Ìõ£¨code/name/³É½»½ð¶î/ÉÏ°ñÔ­Òò£©£¬ÉÏ½»Ëù showTradePublicFile ·µ»ØÈ«ÎÄ 426 ÐÐ£¨º¬ÓªÒµ²¿Ï¯Î»£©£»Á½ËùÁã¼øÈ¨¡¢TLS Ð£ÑéÍ¨¹ý¡£
- akshare stock_individual_fund_flow£¨1.18.97£©µ×²ãÇëÇó push2his.eastmoney.com/api/qt/stock/fflow/daykline/get£¬Óë±¾Ô´ em_fund_flow_120d Í¬Ò»Ö÷»ú£»±¾»ú push2his ·â IP£¨RemoteDisconnected£©£¬akshare Óë em_fund_flow_120d Ò»ÑùÊ§°Ü ¡ª¡ª ²»¹¹³ÉÈÆ¹ý£¬ËÄÎ¬£¨ÖÐµ¥/Ð¡µ¥£©Ðè push2his »Ö¸´¿É´ïºó²Å¿ÉµÃ¡£

ÐÂÔöÎÄ¼þ£¨×ÔÓÐ´úÂë£©£º
| ÎÄ¼þ | ÄÚÈÝ | µ¶ |
|---|---|---|
| .agents/skills/data-access/scripts/sources/akshare.py | akshare_fund_flow_120d£ºµ÷ akshare.stock_individual_fund_flow£¬·µ»Ø 120 ÈÕËÄÎ¬£¨date/main/small/mid/large/super_net + close/change_pct£¬Ôª£©£¬extracted JSON ÂäÅÌ | 9 |

¸ÄÔìÎÄ¼þ£¨ÉÏÓÎÎÄ¼þ±»ÐÞ¸Ä´¦£©£º
| ÎÄ¼þ | ¸Ä¶¯ | µ¶ |
|---|---|---|
| .agents/skills/data-access/scripts/sources/exchange.py | dragon_tiger_backup Éî½»Ëù°´ metadata.pagecount ·­Ò³È¡È«£¨10¡ú32 Ìõ£©£¬ÖðÒ³°ó¶¨ raw | 9 |
| .agents/skills/data-access/scripts/sources/mappers_cn.py | dragon_tiger_backup_map ÔöÖðÐÐ½á¹¹»¯×Ö¶Î dragon_tiger_backup_{code,name,amount,reason}£¨text£©£¬Ç°¶Ë±¸Ô´Ö±½ÓÍ¸ÊÓ | 9 |
| .agents/skills/data-access/scripts/sources/mappers.py | Ôö akshare_fund_flow_map£¨Óë em_fund_flow_120d ¶ÔÆë main_net_inflow_daily_* Ö¤¾Ý£© | 9 |
| datasources/registry.json | Ôö¶Ëµã akshare_fund_flow_120d£¨libs=akshare£© | 9 |
| desktop/src/verticals/finance/lib/fundradarData.ts | Áú»¢°ñ½µ¼¶Á´ loadLhbLive£ºem_daily_dragon_tiger Ê§°Ü ¡ú exchange_dragon_tiger£»Ôö parseLhbBackup/meaningfulLhbBackup£»FrLhbLive.backup ±ê¼Ç | 9 |
| desktop/src/verticals/finance/pages/FundradarLhb.tsx | ±¸Ô´·ÖÖ§£º¾»Âò¶î²»¿ÉµÃÊ±¸ÄÏÔ¡¸³É½»¶î + ÉÏ°ñÔ­Òò¡¹£¬ÕªÒª/³ö´¦±ê×¢¹Ù·½±¸Ô´ | 9 |
| desktop/src/verticals/finance/pages/FundradarDailyReview.tsx | ÓÎ×ÊÕªÒª±¸Ô´·ÖÖ§£¨³ÏÊµ±ê×¢¾»Âò¶î²»¿ÉµÃ£© | 9 |
| desktop/src/verticals/finance/lib/fundradarStock.ts | ×Ê½ðÁ÷½µ¼¶Á´²å akshare ²ã£º120d ¡ú akshare ¡ú sina£»Ôö parseAkshareFlowRaw | 9 |

ÑéÖ¤£º
- desktop build£¨tsc 0 ´íÎó + vite build£©Í¨¹ý£»orchestrator typecheck£¨tsc --noEmit£©0 ´íÎó¡£
- Êµ²â exchange_dragon_tiger 2026-09-28 ·µ»Ø 32 ÌõÉî½»Ëù + 426 ÐÐÉÏ½»ËùÈ«ÎÄ£»akshare_fund_flow_120d µ±Ç° failed£¨push2his ·â IP£¬Ê§°ÜÊôÔ¤ÆÚ£©£¬×Ö¶ÎÆõÔ¼ÒÔ akshare ·µ»ØÁÐÎª×¼£¨ÈÕÆÚ/Ö÷Á¦/Ð¡µ¥/ÖÐµ¥/´óµ¥/³¬´óµ¥¾»¶î£¬Ôª£©¡£
