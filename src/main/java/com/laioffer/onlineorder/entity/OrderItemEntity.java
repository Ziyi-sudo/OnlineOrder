package com.laioffer.onlineorder.entity;


import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
import org.springframework.data.relational.core.sql.In;

@Table("order_items")
public record OrderItemEntity(
        @Id Long id,
        Long menuItemId,
        Long cartId,
        Double price,
        Integer quantity
) {
}
