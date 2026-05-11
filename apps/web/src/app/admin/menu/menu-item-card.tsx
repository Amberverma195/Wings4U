import { formatCents } from "../admin-api";
import type { FullMenuItem } from "./admin-menu.types";
import styles from "./admin-menu.module.css";

type Props = {
  item: FullMenuItem;
  onEdit: () => void;
};

export function MenuItemCard({ item, onEdit }: Props) {
  const pickupActive =
    item.allowedFulfillmentType === "BOTH" ||
    item.allowedFulfillmentType === "PICKUP";
  const deliveryActive =
    item.allowedFulfillmentType === "BOTH" ||
    item.allowedFulfillmentType === "DELIVERY";

  return (
    <div className={styles.card}>
      <div className={styles.cardImageWrapper}>
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            className={styles.cardImage}
          />
        ) : (
          <span className={styles.cardNoImage}>No image</span>
        )}
        <div className={styles.cardBadges}>
          {item.isHidden && (
            <span className={`${styles.badge} ${styles.badgeHidden}`}>
              Hidden
            </span>
          )}
          {item.stockStatus === "LOW_STOCK" && (
            <span className={`${styles.badge} ${styles.badgeLowStock}`}>
              Low Stock
            </span>
          )}
          {item.stockStatus === "UNAVAILABLE" && (
            <span className={`${styles.badge} ${styles.badgeUnavailable}`}>
              Unavailable
            </span>
          )}
        </div>
      </div>

      <div className={styles.cardContent}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>{item.name}</h3>
          <span className={styles.cardPrice}>
            {formatCents(item.basePriceCents)}
          </span>
        </div>

        <div className={styles.cardDesc}>
          {item.description || "No description provided."}
        </div>

        <div className={styles.cardFooter}>
          <div className={styles.fulfillmentModes}>
            <span
              className={styles.fulfillmentChip}
              data-active={pickupActive}
              title="Pickup"
            >
              Pickup
            </span>
            <span
              className={styles.fulfillmentChip}
              data-active={deliveryActive}
              title="Delivery"
            >
              Delivery
            </span>
          </div>
          <button className={styles.editButton} onClick={onEdit}>
            Edit
          </button>
        </div>
      </div>
    </div>
  );
}
