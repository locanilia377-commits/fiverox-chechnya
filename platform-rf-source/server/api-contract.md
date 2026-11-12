# REST-контракт FIVEROX RF (реализуемая локальная версия)

Все ответы JSON. Ошибка: `{error:{code,message}}`. Сессия в HttpOnly-cookie; `credentials:'same-origin'`.
Все изменения требуют `X-CSRF-Token` из session/verify и `operationId` (UUID, либо Idempotency-Key). Auth start/verify проверяют Origin, CSRF не требуют.

- POST `/api/auth/start` `{email}` → `{challengeId,message}` (универсальный ответ).
- POST `/api/auth/verify` `{email,code,challengeId}` → `{session:{email,role,userId,dealerId},csrfToken}`.
- GET `/api/session` → тот же ответ; POST `/api/auth/logout`.
- GET `/api/workspace` → `{leads,stages,actions,today,activities,transfers,sales,dealers,users}`. Сразу scoped на сервере.
- GET `/api/clients/:id` → old card shape `{id,name,city,address,profile,phones,channels,links,stage,manager,due,next,last,note,amount,reason,fields[8],version,history,audit}`.
- PATCH `/api/clients/:id` `{fields,version,operationId}` → card; POST `/api/clients` `{record,operationId}` → card.
- POST `/api/clients/:id/qualify` (alias `convert`) `{profileData,version,operationId}` → та же stable-ID карточка с `kind:'customer'`. Staff only.
- PATCH `/api/clients/:id/profile` `{profileData,version,operationId}` → профиль без смены этапа. Поля профиля: `pointType,assortment,targetAssortment,brand,brands,source,city,contractReference` (строки). Договорный реквизит staff-only в DTO.
- POST `/api/clients/:id/history` (alias `contacts`) `{action,note,operationId}` → событие истории.
- POST `/api/activities`, `/api/sales`: `{record,operationId}`; PATCH `/:id`: `{record,version,operationId}` → запись.
- GET `/api/transfers`; POST `{leadId,dealerId,assigneeUserId,note,expiresAt?,shareContacts?,operationId}`.
- POST `/api/transfers/:id/accept|decline|revoke` `{version,operationId,reason?}`.
- Staff справочники: GET `/api/dealers`, `/api/users`; admin GET/POST `/api/admin/users` (приглашение), GET/POST `/api/admin/dealers`, PATCH `/api/admin/users/:id` (роль/статус).

`fields`: этап, текстовое имя ответственного (не право), следующий контакт ISO, следующий шаг, последний контакт ISO, заметка, оценка строкой, причина отказа.
`role`: `admin`, `coordinator`, `dealer_manager`. Manager получает только собственное active assignment; pending transfer — безопасная проекция без контактов/заметок прежнего назначения.

Локальная dev-среда: только вымышленные `*.example.test`, почтовый sink только localhost, коды не зашиты в frontend. Production требует SMTP и PostgreSQL с секретами env, запрещает dev mail sink/seed.
