/*
 Navicat Premium Dump SQL

 Source Server         : 13306
 Source Server Type    : MySQL
 Source Server Version : 80046 (8.0.46)
 Source Host           : localhost:13306
 Source Schema         : takeout_soft_test

 Target Server Type    : MySQL
 Target Server Version : 80046 (8.0.46)
 File Encoding         : 65001

 Date: 17/06/2026 19:24:10
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

create database takeout_soft_test;
use takeout_soft_test;

-- ----------------------------
-- Table structure for address
-- ----------------------------
DROP TABLE IF EXISTS `address`;
CREATE TABLE `address`  (
  `id` bigint NOT NULL COMMENT '地址ID（雪花算法）',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `consignee` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '收货人姓名',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '联系电话',
  `province` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '省',
  `city` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '市',
  `district` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '区',
  `detail` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '详细地址',
  `longitude` decimal(10, 7) NULL DEFAULT NULL COMMENT '经度',
  `latitude` decimal(10, 7) NULL DEFAULT NULL COMMENT '纬度',
  `isDefault` tinyint NULL DEFAULT 0 COMMENT '是否默认地址：0-否 1-是',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '收货地址表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for cart
-- ----------------------------
DROP TABLE IF EXISTS `cart`;
CREATE TABLE `cart`  (
  `id` bigint NOT NULL COMMENT '购物车ID（雪花算法）',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `shopId` bigint NOT NULL COMMENT '商店ID',
  `foodId` bigint NOT NULL COMMENT '食品ID',
  `specId` bigint NULL DEFAULT NULL COMMENT '规格ID',
  `foodName` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '食品名称（冗余）',
  `foodImage` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '食品图片（冗余）',
  `specName` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '规格名称（冗余）',
  `price` decimal(10, 2) NOT NULL COMMENT '单价（冗余）',
  `quantity` int NOT NULL DEFAULT 1 COMMENT '数量',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '购物车表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for food
-- ----------------------------
DROP TABLE IF EXISTS `food`;
CREATE TABLE `food`  (
  `id` bigint NOT NULL COMMENT '食品ID（雪花算法）',
  `shopId` bigint NOT NULL COMMENT '商店ID',
  `categoryId` bigint NOT NULL COMMENT '分类ID',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '食品名称',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '食品描述',
  `image` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '食品图片路径',
  `price` decimal(10, 2) NOT NULL COMMENT '价格',
  `originalPrice` decimal(10, 2) NULL DEFAULT NULL COMMENT '原价',
  `monthlySales` int NULL DEFAULT 0 COMMENT '月销量',
  `rating` decimal(2, 1) NULL DEFAULT 5.0 COMMENT '评分',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'on' COMMENT '状态：on-上架 off-下架',
  `sort` int NULL DEFAULT 0 COMMENT '排序号',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE,
  INDEX `idx_categoryId`(`categoryId` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '食品表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for food_category
-- ----------------------------
DROP TABLE IF EXISTS `food_category`;
CREATE TABLE `food_category`  (
  `id` bigint NOT NULL COMMENT '分类ID（雪花算法）',
  `shopId` bigint NOT NULL COMMENT '商店ID',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '分类名称',
  `sort` int NULL DEFAULT 0 COMMENT '排序号',
  `icon` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '分类图标',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '食品分类表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for food_image
-- ----------------------------
DROP TABLE IF EXISTS `food_image`;
CREATE TABLE `food_image`  (
  `id` bigint NOT NULL COMMENT '图片ID（雪花算法）',
  `foodId` bigint NOT NULL COMMENT '食品ID',
  `imageUrl` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '图片路径',
  `sort` int NULL DEFAULT 0 COMMENT '排序号',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_foodId`(`foodId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '食品图片表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for food_spec
-- ----------------------------
DROP TABLE IF EXISTS `food_spec`;
CREATE TABLE `food_spec`  (
  `id` bigint NOT NULL COMMENT '规格ID（雪花算法）',
  `foodId` bigint NOT NULL COMMENT '食品ID',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '规格名称（如：大份、中份）',
  `price` decimal(10, 2) NOT NULL COMMENT '规格价格',
  `sort` int NULL DEFAULT 0 COMMENT '排序号',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_foodId`(`foodId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '食品规格表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for hot_keyword
-- ----------------------------
DROP TABLE IF EXISTS `hot_keyword`;
CREATE TABLE `hot_keyword`  (
  `id` bigint NOT NULL COMMENT '关键词ID（雪花算法）',
  `keyword` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '关键词',
  `searchCount` int NULL DEFAULT 0 COMMENT '搜索次数',
  `sort` int NULL DEFAULT 0 COMMENT '排序号',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'active' COMMENT '状态：active/disabled',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_keyword`(`keyword` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '热门搜索词表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for merchant_settlement
-- ----------------------------
DROP TABLE IF EXISTS `merchant_settlement`;
CREATE TABLE `merchant_settlement`  (
  `id` bigint NOT NULL COMMENT '主键ID（雪花算法）',
  `shopId` bigint NOT NULL COMMENT '商户ID',
  `periodStart` datetime NULL DEFAULT NULL COMMENT '结算周期开始',
  `periodEnd` datetime NULL DEFAULT NULL COMMENT '结算周期结束',
  `orderCount` int NULL DEFAULT 0 COMMENT '订单数',
  `totalAmount` decimal(12, 2) NULL DEFAULT 0.00 COMMENT '总金额',
  `commissionAmount` decimal(12, 2) NULL DEFAULT 0.00 COMMENT '佣金金额',
  `settlementAmount` decimal(12, 2) NULL DEFAULT 0.00 COMMENT '结算金额',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'pending' COMMENT '状态：pending/settled',
  `settleTime` datetime NULL DEFAULT NULL COMMENT '结算时间',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE,
  INDEX `idx_period`(`periodStart` ASC, `periodEnd` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '商户结算记录表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for operation_log
-- ----------------------------
DROP TABLE IF EXISTS `operation_log`;
CREATE TABLE `operation_log`  (
  `id` bigint NOT NULL COMMENT '主键ID（雪花算法）',
  `operatorId` bigint NOT NULL COMMENT '操作人ID',
  `operatorRole` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '操作人角色',
  `module` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '模块',
  `action` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '操作类型',
  `targetType` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '目标类型',
  `targetId` bigint NULL DEFAULT NULL COMMENT '目标ID',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL COMMENT '操作内容',
  `ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT 'IP地址',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_operatorId`(`operatorId` ASC) USING BTREE,
  INDEX `idx_createTime`(`createTime` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '管理员操作日志表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for order_item
-- ----------------------------
DROP TABLE IF EXISTS `order_item`;
CREATE TABLE `order_item`  (
  `id` bigint NOT NULL COMMENT '明细ID（雪花算法）',
  `orderId` bigint NOT NULL COMMENT '订单ID',
  `foodId` bigint NOT NULL COMMENT '食品ID',
  `specId` bigint NULL DEFAULT NULL COMMENT '规格ID',
  `foodName` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '食品名称',
  `foodImage` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '食品图片',
  `specName` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '规格名称',
  `price` decimal(10, 2) NOT NULL COMMENT '单价',
  `quantity` int NOT NULL COMMENT '数量',
  `subtotal` decimal(10, 2) NOT NULL COMMENT '小计金额',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_orderId`(`orderId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '订单明细表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for order_status_log
-- ----------------------------
DROP TABLE IF EXISTS `order_status_log`;
CREATE TABLE `order_status_log`  (
  `id` bigint NOT NULL COMMENT '日志ID（雪花算法）',
  `orderId` bigint NOT NULL COMMENT '订单ID',
  `fromStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '原状态',
  `toStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '新状态',
  `operator` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '操作人',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '备注',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_orderId`(`orderId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '订单状态日志表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for orders
-- ----------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders`  (
  `id` bigint NOT NULL COMMENT '订单ID（雪花算法）',
  `orderNo` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '订单编号',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `shopId` bigint NOT NULL COMMENT '商店ID',
  `shopName` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '商店名称（冗余）',
  `orderType` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'takeout' COMMENT '订单类型：takeout-外卖 dine-in-堂食',
  `addressId` bigint NULL DEFAULT NULL COMMENT '收货地址ID（外卖订单必填）',
  `consignee` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '收货人（外卖订单必填）',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '联系电话（外卖订单必填）',
  `address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '收货地址（外卖订单必填）',
  `tableNumber` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '桌号（堂食订单使用）',
  `totalAmount` decimal(10, 2) NOT NULL COMMENT '订单总金额',
  `deliveryFee` decimal(10, 2) NULL DEFAULT 0.00 COMMENT '配送费',
  `packagingFee` decimal(10, 2) NULL DEFAULT 0.00 COMMENT '包装费',
  `discountAmount` decimal(10, 2) NULL DEFAULT 0.00 COMMENT '优惠金额',
  `payAmount` decimal(10, 2) NOT NULL COMMENT '实付金额',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'unpaid' COMMENT '订单状态：unpaid/paid/delivering/completed/cancelled',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '订单备注',
  `cancelReason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '取消原因',
  `payTime` datetime NULL DEFAULT NULL COMMENT '支付时间',
  `deliverTime` datetime NULL DEFAULT NULL COMMENT '配送时间',
  `completeTime` datetime NULL DEFAULT NULL COMMENT '完成时间',
  `cancelTime` datetime NULL DEFAULT NULL COMMENT '取消时间',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_orderNo`(`orderNo` ASC) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE,
  INDEX `idx_createTime`(`createTime` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '订单主表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for payment
-- ----------------------------
DROP TABLE IF EXISTS `payment`;
CREATE TABLE `payment`  (
  `id` bigint NOT NULL COMMENT '支付ID（雪花算法）',
  `paymentNo` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '支付流水号',
  `orderId` bigint NOT NULL COMMENT '订单ID',
  `orderNo` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '订单编号',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `amount` decimal(10, 2) NOT NULL COMMENT '支付金额',
  `payMethod` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'balance' COMMENT '支付方式：balance/wechat/alipay',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'pending' COMMENT '支付状态：pending/success/failed/refunded',
  `transactionId` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '第三方交易号',
  `payTime` datetime NULL DEFAULT NULL COMMENT '支付时间',
  `refundTime` datetime NULL DEFAULT NULL COMMENT '退款时间',
  `refundAmount` decimal(10, 2) NULL DEFAULT NULL COMMENT '退款金额',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_paymentNo`(`paymentNo` ASC) USING BTREE,
  INDEX `idx_orderId`(`orderId` ASC) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '支付记录表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for review
-- ----------------------------
DROP TABLE IF EXISTS `review`;
CREATE TABLE `review`  (
  `id` bigint NOT NULL COMMENT '评价ID（雪花算法）',
  `orderId` bigint NOT NULL COMMENT '订单ID',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `shopId` bigint NOT NULL COMMENT '商店ID',
  `foodId` bigint NULL DEFAULT NULL COMMENT '食品ID（可选）',
  `userName` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '用户昵称（冗余）',
  `userAvatar` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '用户头像（冗余）',
  `rating` tinyint NOT NULL COMMENT '评分：1-5',
  `content` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '评价内容',
  `images` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '评价图片（JSON数组）',
  `isAnonymous` tinyint NULL DEFAULT 0 COMMENT '是否匿名：0-否 1-是',
  `reply` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '商家回复',
  `replyTime` datetime NULL DEFAULT NULL COMMENT '回复时间',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_orderId`(`orderId` ASC) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE,
  INDEX `idx_foodId`(`foodId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '评价表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for review_like
-- ----------------------------
DROP TABLE IF EXISTS `review_like`;
CREATE TABLE `review_like`  (
  `id` bigint NOT NULL COMMENT 'ID（雪花算法）',
  `reviewId` bigint NOT NULL COMMENT '评论ID',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_review_user`(`reviewId` ASC, `userId` ASC) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '评论点赞表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for search_history
-- ----------------------------
DROP TABLE IF EXISTS `search_history`;
CREATE TABLE `search_history`  (
  `id` bigint NOT NULL COMMENT '历史ID（雪花算法）',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `keyword` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '搜索关键词',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_userId`(`userId` ASC) USING BTREE,
  INDEX `idx_createTime`(`createTime` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '搜索历史表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for shop
-- ----------------------------
DROP TABLE IF EXISTS `shop`;
CREATE TABLE `shop`  (
  `id` bigint NOT NULL COMMENT '商店ID（雪花算法）',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '商店名称',
  `logo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '商店Logo路径',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '商店描述',
  `businessLicense` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '营业执照路径',
  `foodLicense` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '食品经营许可证路径',
  `contractInfo` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '合同信息',
  `address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '商店地址',
  `longitude` decimal(10, 7) NULL DEFAULT NULL COMMENT '经度',
  `latitude` decimal(10, 7) NULL DEFAULT NULL COMMENT '纬度',
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '联系电话',
  `businessHours` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '营业时间',
  `deliveryFee` decimal(10, 2) NULL DEFAULT 0.00 COMMENT '配送费',
  `minOrderAmount` decimal(10, 2) NULL DEFAULT 0.00 COMMENT '起送金额',
  `rating` decimal(2, 1) NULL DEFAULT 5.0 COMMENT '评分',
  `monthlySales` int NULL DEFAULT 0 COMMENT '月销量',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'open' COMMENT '状态：open/closed/rest',
  `auditStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'approved' COMMENT '审核状态：pending/approved/rejected/banned',
  `auditReason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '审核原因',
  `auditTime` datetime NULL DEFAULT NULL COMMENT '审核时间',
  `violationCount` int NULL DEFAULT 0 COMMENT '违规次数',
  `restrictStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'normal' COMMENT '管控状态：normal/restricted/banned',
  `commissionRate` decimal(5, 4) NULL DEFAULT 0.1500 COMMENT '佣金比例',
  `merchantLevel` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT 'bronze' COMMENT '商户等级：gold/silver/bronze',
  `deliveryRange` decimal(10, 2) NULL DEFAULT 3000.00 COMMENT '配送范围（米）',
  `deliveryFeeRules` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '阶梯配送费规则（JSON）',
  `announcement` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '店铺公告',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_status`(`status` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '商店表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for shop_audit_log
-- ----------------------------
DROP TABLE IF EXISTS `shop_audit_log`;
CREATE TABLE `shop_audit_log`  (
  `id` bigint NOT NULL COMMENT '主键ID（雪花算法）',
  `shopId` bigint NOT NULL COMMENT '商户ID',
  `operatorId` bigint NULL DEFAULT NULL COMMENT '操作人ID（管理员）',
  `action` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '操作：submit/approve/reject/warn/ban',
  `fromStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '原状态',
  `toStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '新状态',
  `reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '原因',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_shopId`(`shopId` ASC) USING BTREE,
  INDEX `idx_operatorId`(`operatorId` ASC) USING BTREE,
  INDEX `idx_createTime`(`createTime` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '商户入驻审核记录表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for user
-- ----------------------------
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user`  (
  `id` bigint NOT NULL COMMENT '用户ID（雪花算法）',
  `userAccount` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '用户账号',
  `userPassword` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '用户密码（BCrypt加密）',
  `userName` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '用户昵称',
  `userAvatar` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '用户头像路径',
  `userProfile` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '用户简介',
  `userPhone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '手机号',
  `userRole` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'user' COMMENT '用户角色：user/admin',
  `shopId` bigint NULL DEFAULT NULL COMMENT '商家绑定的门店ID',
  `realName` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '真实姓名',
  `idCard` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '身份证号（AES加密存储）',
  `blacklistStatus` tinyint NULL DEFAULT 0 COMMENT '黑名单状态：0正常 1黑名单',
  `freezeStatus` tinyint NULL DEFAULT 0 COMMENT '冻结状态：0正常 1冻结',
  `totalConsumption` decimal(12, 2) NULL DEFAULT 0.00 COMMENT '累计消费',
  `refundCount` int NULL DEFAULT 0 COMMENT '退款次数',
  `userStatus` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'active' COMMENT '用户状态：active/disabled',
  `balance` decimal(10, 2) NULL DEFAULT 0.00 COMMENT '账户余额',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updateTime` datetime NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除：0-未删除 1-已删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_userAccount`(`userAccount` ASC) USING BTREE,
  INDEX `idx_userPhone`(`userPhone` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户表' ROW_FORMAT = DYNAMIC;

-- ----------------------------
-- Table structure for user_favorite
-- ----------------------------
DROP TABLE IF EXISTS `user_favorite`;
CREATE TABLE `user_favorite`  (
  `id` bigint NOT NULL COMMENT '收藏ID（雪花算法）',
  `userId` bigint NOT NULL COMMENT '用户ID',
  `foodId` bigint NOT NULL COMMENT '食品ID',
  `createTime` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `isDelete` tinyint NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_food`(`userId` ASC, `foodId` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '用户收藏表' ROW_FORMAT = DYNAMIC;

SET FOREIGN_KEY_CHECKS = 1;
