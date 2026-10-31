# Tell TextBack when you're driving (iPhone, 2 minutes)

When Driving Focus turns on, your phone tells TextBack, and it answers customers right away instead of waiting
3 minutes for you. When it turns off, texts come to you first again.

You need: your TextBack address (e.g. `https://textback.yourname.workers.dev`) and your `STATUS_TOKEN`.
`/textback-setup` gives you both.

## Driving starts
1. Shortcuts app > Automation > New Automation > **Driving** (or **Focus > Driving**) > **When Turning On**.
2. Choose **Run Immediately** and turn off "Notify When Run".
3. Add the action **Get Contents of URL**:
   - URL: `https://textback.yourname.workers.dev/status`
   - Method: **POST**
   - Headers: `Authorization` = `Bearer YOUR_STATUS_TOKEN`
   - Request Body: **Form**, field `mode` = `driving`
4. Done.

## Driving ends
Same again with **When Turning Off** and `mode` = `free`.

## More triggers (optional)
- **CarPlay connects / disconnects**: same actions, if you don't use Driving Focus.
- **Arrive at / leave a place** (your shop, a big job site): `mode` = `busy` on arrive, `free` on leave.
- **Work Focus**: `busy` / `free`.
Add a field `minutes` (e.g. `120`) to make a status expire on its own. Without it, it expires after 3 hours, in case
the "off" automation never runs.

## Android
Samsung Modes and Routines, Tasker or MacroDroid: on "Driving mode" or "Bluetooth connected to car", send an HTTP
POST with the same URL, header and form field.

Texting `busy 2h` or `back` to the business number always works too, and beats whatever the phone reports while it
lasts. `pause` beats everything.
