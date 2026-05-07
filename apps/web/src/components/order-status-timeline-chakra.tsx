"use client";

import type { ComponentType } from "react";
import {
  ChakraProvider,
  defaultSystem,
  Text,
  Timeline,
} from "@chakra-ui/react";
import { cents, statusEventWhenLine } from "@/lib/format";
import type { OrderStatus, OrderStatusEvent } from "@/lib/types";
import {
  LuCheck,
  LuCircleAlert,
  LuPackage,
  LuShip,
  LuShoppingBag,
  LuUtensilsCrossed,
  LuX,
} from "react-icons/lu";

function timelineIconForStatus(toStatus: string): ComponentType<{ size?: number | string }> {
  switch (toStatus as OrderStatus) {
    case "PLACED":
      return LuShoppingBag;
    case "ACCEPTED":
      return LuCheck;
    case "PREPARING":
      return LuUtensilsCrossed;
    case "READY":
      return LuPackage;
    case "OUT_FOR_DELIVERY":
      return LuShip;
    case "DELIVERED":
    case "PICKED_UP":
      return LuCheck;
    case "CANCELLED":
      return LuX;
    case "NO_SHOW_PICKUP":
    case "NO_SHOW_DELIVERY":
    case "NO_PIN_DELIVERY":
      return LuCircleAlert;
    default:
      return LuPackage;
  }
}

function isAddItemsApprovedEvent(event: OrderStatusEvent): boolean {
  return event.event_type === "CHANGE_REQUEST_APPROVED";
}

function timelineTitleForEvent(
  event: OrderStatusEvent,
  getStatusLabel: (toStatus: string) => string,
): string {
  if (isAddItemsApprovedEvent(event)) return "Item added";
  return getStatusLabel(event.to_status);
}

function timelineDetailForEvent(event: OrderStatusEvent): string | null {
  if (!isAddItemsApprovedEvent(event)) return event.reason_text;
  const text = event.reason_text?.trim();
  if (!text) return null;

  const legacyMatch = text.match(/^Add-items request .+ approved \(\+(\d+).+\)$/i);
  if (legacyMatch) {
    return `Additional item - ${cents(Number.parseInt(legacyMatch[1] ?? "0", 10))}`;
  }
  return text;
}

type Props = {
  events: OrderStatusEvent[];
  getStatusLabel: (toStatus: string) => string;
  /** Larger type and shorter dates for popovers and expanded views */
  readable?: boolean;
};

export function OrderStatusTimelineChakra({ events, getStatusLabel, readable = false }: Props) {
  const size = readable ? "md" : "sm";
  const iconPx = readable ? 16 : 14;

  return (
    <ChakraProvider value={defaultSystem}>
      <Timeline.Root maxW="100%" size={size} colorPalette="orange" variant="solid">
        {events.map((event) => {
          const Icon = timelineIconForStatus(event.to_status);
          const title = timelineTitleForEvent(event, getStatusLabel);
          const when = statusEventWhenLine(event.created_at);
          const detail = timelineDetailForEvent(event);
          return (
            <Timeline.Item key={event.id}>
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator>
                  <Icon size={iconPx} />
                </Timeline.Indicator>
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title
                  textStyle={readable ? "md" : "sm"}
                  fontWeight={readable ? "semibold" : "700"}
                  fontFamily="'DM Sans', sans-serif"
                >
                  {title}
                </Timeline.Title>
                <Timeline.Description
                  color="fg"
                  textStyle="sm"
                  fontWeight="semibold"
                  fontFamily="'DM Sans', sans-serif"
                  mt="0.1rem"
                >
                  {when}
                </Timeline.Description>
                {detail ? (
                  <Text textStyle="sm" color={readable ? "fg.muted" : undefined}>
                    {detail}
                  </Text>
                ) : null}
              </Timeline.Content>
            </Timeline.Item>
          );
        })}
      </Timeline.Root>
    </ChakraProvider>
  );
}
