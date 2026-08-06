
import order_model from "../../../DB/models/order_model.js";

const orderClientProjection = Object.freeze({
    _id: 1,
    name: 1,
    image_url: 1,
    coverImage_url: 1,
    country: 1,
});

const toPlainRecord = (record) => record?._doc ?? record;

const toOrderClient = (clientRecord) => {
    const client = toPlainRecord(clientRecord);
    if (!client) return client;

    return {
        _id: client._id,
        name: client.name,
        image_url: client.image_url,
        coverImage_url: client.coverImage_url,
        country: client.country,
    };
};

const toOrderResponse = (orderRecord) => {
    const order = toPlainRecord(orderRecord);

    return {
        ...order,
        clientId: toOrderClient(order.clientId),
    };
};

// Get All Orders
export const getAllOrders = async (req, res) => {
    try {
        const orderRecords = await order_model.find().populate("clientId", orderClientProjection).populate("freelancerId").populate("serviceId");
        const allOrders = orderRecords.map(toOrderResponse);
        if(allOrders.length !== 0) {
            res.status(200).json(allOrders);
        }
        else {
            res.status(404).json({ msg: "No orders found!" });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json("Somthing went wrong!");
    }
}

// Get User Orders
export const getUserOrders = async (req, res) => {
    try {
        const userId = req.params.id;
        const role = req.params.role
        var Orders

        if(role == "freelancer") {
            Orders = await order_model.find({freelancerId: userId}).populate("clientId", orderClientProjection).populate("serviceId").populate("freelancerId");
        }
        else if(role == "client") {
            Orders = await order_model.find({clientId: userId}).populate("clientId", orderClientProjection).populate("serviceId").populate("freelancerId");
        }
        else {
            return res.status(401).json({ msg:"Unauthorized!" });
        }

        if(Orders.length == 0) {
            return res.status(404).json({ msg:"No orders found!" });
        }

        const ordersData = Orders.map((order) => {
            const modifiedRequest = toOrderResponse(order);
            modifiedRequest.serviceId = { ...toPlainRecord(modifiedRequest.serviceId) }; // Create a copy of the freelancerId object
            modifiedRequest.serviceId.serviceCover_url = "http://" + req.hostname + ":3000/uploads/" + modifiedRequest.serviceId.serviceCover_url;
            return modifiedRequest;
        });

        res.status(200).json({ ordersData });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Add Order
export const addOrder = async (req, res) => {
    try {
        const newOrder = new order_model({
            ...req.body,
        });

        await newOrder.save();
        res.status(200).send("Order has been created successfuly.");
    } catch (error) {
        console.log(error);
        res.status(500).send("Somthing went wrong!");
    }
}

// Update Order
export const updateOrder = async (req, res) => {
    try {
        const orderId = req.params.id;

        const orderToUpdate = await order_model.findById(orderId);

        if(orderToUpdate) {
            const filter = { _id: orderId }; // specify the condition to match the document
            const update = { $set: { orderImage_url: req.body.orderImage_url, freelancerId: req.body.freelancerId, clientId: req.body.clientId, orderTitle: req.body.orderTitle, orderPrice: req.body.orderPrice} }; // specify the update operation

            await order_model.updateOne(filter, update);
            res.status(200).send("Order has been updated successfuly.");
        }
        return res.status(200).send("There is no order with such id to update.");
    } catch (error) {
        console.log(error);
        res.status(500).send("Somthing went wrong!");
    }
}

// Update Order Status
export const updateOrderStatus = async (req, res) => {
    try {
        const orderId = req.params.id;

        const orderToUpdate = await order_model.findById(orderId);

        if(orderToUpdate) {
            const filter = { _id: orderId }; // specify the condition to match the document
            const update = { $set: { orderStatus: "Completed" } }; // specify the update operation

            await order_model.updateOne(filter, update);
            return res.status(200).json({ msg:"Order has been updated successfuly." });
        }

        res.status(200).json({ msg:"There is no order with such id to update." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ msg:"Somthing went wrong!" });
    }
}

// Delete Order
export const deleteOrder = async (req, res) => {
    try {
        const orderId = req.params.id
        const orderToDelete = await order_model.findById(orderId);

        if(orderToDelete){
            const filter = { _id: orderId };

            await order_model.deleteOne(filter);
            res.status(200).send("Order has been deleted successfuly.");
        }
        else {
            res.status(200).send("There is no order with such id to delete.");
        }
    } catch (error) {
        console.log(error);
        res.status(500).send("Somthing went wrong!");
    }
}
