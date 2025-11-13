import { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from '../shopify.server';

/**
 * This endpoint creates a new webhook subscription
 * Used when a required webhook (like ORDERS_CREATE) is missing
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);

    const body = await request.json();
    const { topic } = body;

    if (!topic) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing topic parameter'
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const appUrl = process.env.SHOPIFY_APP_URL || "";

    if (!appUrl) {
      return new Response(JSON.stringify({
        success: false,
        error: 'App URL not configured in environment'
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Determine the callback URL based on the topic
    let callbackPath = '';
    switch (topic) {
      case 'ORDERS_CREATE':
        callbackPath = '/webhooks/app/orders_create';
        break;
      case 'APP_UNINSTALLED':
        callbackPath = '/webhooks/app/uninstalled';
        break;
      case 'APP_SUBSCRIPTIONS_UPDATE':
        callbackPath = '/webhooks/app/scopes_update';
        break;
      default:
        return new Response(JSON.stringify({
          success: false,
          error: `Unsupported webhook topic: ${topic}`
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
    }

    const callbackUrl = `${appUrl}${callbackPath}`;

    // Create the webhook subscription
    const mutation = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    `;

    const response = await admin.graphql(mutation, {
      variables: {
        topic: topic,
        webhookSubscription: {
          callbackUrl: callbackUrl,
          format: "JSON"
        },
      },
    });

    const result = await response.json();

    if (result.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
      console.error("[CREATE-WEBHOOK] Errors:", result.data.webhookSubscriptionCreate.userErrors);
      return new Response(JSON.stringify({
        success: false,
        error: result.data.webhookSubscriptionCreate.userErrors
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[CREATE-WEBHOOK] Successfully created webhook ${topic} at: ${callbackUrl}`);

    return new Response(JSON.stringify({
      success: true,
      webhook: result.data?.webhookSubscriptionCreate?.webhookSubscription,
      message: `Webhook ${topic} created successfully`
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[CREATE-WEBHOOK ERROR]", err);
    return new Response(JSON.stringify({
      success: false,
      error: "Failed to create webhook"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
