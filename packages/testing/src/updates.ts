import type { TgUserInput } from './init-data';

export type TgUpdate = { update_id: number } & Record<string, unknown>;

const DEFAULT_USER: TgUserInput = { id: 1, first_name: 'Test' };

let updateId = 0;
let messageId = 0;

const now = () => Math.floor(Date.now() / 1000);

function tgUser(user: TgUserInput) {
  return { is_bot: false, ...user };
}

function privateMessage(from: TgUserInput, fields: Record<string, unknown>) {
  return {
    message_id: ++messageId,
    date: now(),
    chat: { id: from.id, type: 'private', first_name: from.first_name, username: from.username },
    from: tgUser(from),
    ...fields,
  };
}

function textFields(text: string): Record<string, unknown> {
  const command = /^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?/.exec(text);
  if (!command) return { text };
  return { text, entities: [{ type: 'bot_command', offset: 0, length: command[0].length }] };
}

export const updates = {
  message({ from, text }: { from: TgUserInput; text: string }): TgUpdate {
    return { update_id: ++updateId, message: privateMessage(from, textFields(text)) };
  },

  command(cmd: string, payload?: string, from: TgUserInput = DEFAULT_USER): TgUpdate {
    const name = cmd.replace(/^\//, '');
    const text = payload ? `/${name} ${payload}` : `/${name}`;
    return {
      update_id: ++updateId,
      message: privateMessage(from, {
        text,
        entities: [{ type: 'bot_command', offset: 0, length: name.length + 1 }],
      }),
    };
  },

  preCheckoutQuery({
    payload,
    totalAmount,
    from,
    currency = 'XTR',
  }: {
    payload: string;
    totalAmount: number;
    from: TgUserInput;
    currency?: string;
  }): TgUpdate {
    const id = ++updateId;
    return {
      update_id: id,
      pre_checkout_query: {
        id: `pcq-${id}`,
        from: tgUser(from),
        currency,
        total_amount: totalAmount,
        invoice_payload: payload,
      },
    };
  },

  successfulPayment({
    payload,
    chargeId,
    totalAmount,
    from,
    subscriptionExpirationDate,
    isRecurring,
    isFirstRecurring,
  }: {
    payload: string;
    chargeId: string;
    totalAmount: number;
    from: TgUserInput;
    subscriptionExpirationDate?: number;
    isRecurring?: boolean;
    isFirstRecurring?: boolean;
  }): TgUpdate {
    return {
      update_id: ++updateId,
      message: privateMessage(from, {
        successful_payment: {
          currency: 'XTR',
          total_amount: totalAmount,
          invoice_payload: payload,
          telegram_payment_charge_id: chargeId,
          provider_payment_charge_id: 'prov_' + chargeId,
          ...(subscriptionExpirationDate !== undefined
            ? { subscription_expiration_date: subscriptionExpirationDate }
            : {}),
          ...(isRecurring !== undefined ? { is_recurring: isRecurring } : {}),
          ...(isFirstRecurring !== undefined ? { is_first_recurring: isFirstRecurring } : {}),
        },
      }),
    };
  },
};
