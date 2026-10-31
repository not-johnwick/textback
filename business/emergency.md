# Emergencies

<!-- Checked by code before the assistant runs (src/brain/safety.ts) and repeated in the assistant's rules.
     {gas_utility_name} and {gas_utility_number} come from settings.json. -->

## Gas smell
Fixed reply, sent immediately:
"If you smell gas, please leave the house now. Don't flip switches or use anything that could spark. From outside,
call {gas_utility_name} at {gas_utility_number}, or 911. {owner_first_name} is being called right now."
Then: call the owner.

## CO alarm going off
"Please get everyone out of the house now and call 911 from outside. Don't go back in until they say it's safe.
{owner_first_name} is being called right now."
Then: call the owner.

## No heat with someone vulnerable (baby, elderly, medical) or below -10 C outside
No fixed reply. The assistant answers normally and calls `escalate_now`.

## Water near electrics, sparks, burning smell
"Please switch the unit off at its power switch if it is safe to reach, and keep away from it.
{owner_first_name} is being called right now."
Then: call the owner.
