"use client";

import type { ComponentType } from "react";
import {
  ChakraProvider,
  defaultSystem,
  Text,
  Timeline,
} from "@chakra-ui/react";
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

type Props = {
  events: OrderStatusEvent[];
  getStatusLabel: (toStatus: string) => string;
};

export function OrderStatusTimelineChakra({ events, getStatusLabel }: Props) {
  return (
    <ChakraProvider value={defaultSystem}>
      <Timeline.Root maxW="100%" size="sm" colorPalette="orange" variant="solid">
        {events.map((event) => {
          const Icon = timelineIconForStatus(event.to_status);
          const title = getStatusLabel(event.to_status);
          const when = new Date(event.created_at).toLocaleString();
          return (
            <Timeline.Item key={event.id}>
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator>
                  <Icon size={14} />
                </Timeline.Indicator>
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title textStyle="sm">{title}</Timeline.Title>
                <Timeline.Description>{when}</Timeline.Description>
                {event.reason_text ? (
                  <Text textStyle="sm">{event.reason_text}</Text>
                ) : null}
              </Timeline.Content>
            </Timeline.Item>
          );
        })}
      </Timeline.Root>
    </ChakraProvider>
  );
}
