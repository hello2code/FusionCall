'use strict';

// [START functions_pubsub_publish]
const {PubSub} = require('@google-cloud/pubsub');
// Instantiates a client
const pubsub = new PubSub();

// Setup Airtable
const Airtable = require('airtable');
const airtableEndpoint = "https://api.airtable.com";
const airtableAPIKey = "keyWNvIws9TNP3Q9W";
const tablePaymentCompleted = "Payment Completed";
Airtable.configure({
    endpointUrl: airtableEndpoint,
    apiKey: airtableAPIKey
});
const base = Airtable.base("appUjyaWbH3gUfaZt");

async function publishPaymentApprovedMessage(records){
    // References an existing topic
    return new Promise( resolve => {
        try {
            const topic = pubsub.topic("payment-received");
            const messageObject = {
                data: {
                    message: {
                        'payer_email': records[0].fields['Payer Email'],
                        'amount': record[0].fields['Amount After Fee']
                    },
                },
            };
            const messageBuffer = Buffer.from(JSON.stringify(messageObject), 'utf8');

            topic.publish(messageBuffer);
            resolve(true)
        } catch (err) {
            console.error(err);
            resolve(false)
        }
    });
}

async function createRecordInAirtable(data, table){
    const { id, amount, payer_email, type, status } = data
    console.log("createRecordInAirtable field data", data)
    console.log("create in table", table)
    return new Promise( resolve => {
    base(table).create([
        {
          "fields": {
            "Transaction ID": id,
            "Amount After Fee": amount,
            "Payer Email": payer_email,
            "Type": type,
            "Status": status
          }
        }
      ], function(err, records) {
        if (err) {
          console.error("Airtable create error", err);
          throw err
        }
        records.forEach(function (record) {
            console.log("Log each created record", record.getId());
        });

        resolve(records)
      });
    });
}

async function findRecordInAirtable(filterExpression, table){
    let resultRecords = []
    return new Promise( resolve => {
        base(table).select({
            // Selecting the first 3 records in Grid view:
            maxRecords: 10,
            view: "Grid view",
            filterByFormula: filterExpression
        }).eachPage(function page(records, fetchNextPage) {
            // This function (`page`) will get called for each page of records.
        
            records.forEach(function(record) {
                console.log('Retrieved', record.get('Transaction ID'));
                const recordFields = record.fields;
                resultRecords = [...resultRecords, {...recordFields}]
            });
        
            // To fetch the next page of records, call `fetchNextPage`.
            // If there are more records, `page` will get called again.
            // If there are no more records, `done` will get called.
            fetchNextPage();
        
        }, function done(err) {
            if (err) { 
                throw(err)
            }
            console.log("return", resultRecords)
            resolve(resultRecords)
        });
    })
}

exports.functionFindRecordInAirtable = async ( req, res ) => {

    try{
        let result = await findRecordInAirtable(`{Transaction ID} = '${req.body.id}'`, tablePaymentCompleted);
        console.log("response", result)
        res.status(200).json({success: true, data: result}).send()
    }catch(err){
        res.status(500).json(err).send()
    }

}

exports.functionAddToAirtable = async ( req, res ) => {

    try{
        let result = await createRecordInAirtable({id: req.body.id}, 'Payment Completed')
        res.status(200).json({message: "added", data: result}).send()
    }catch(err){
        console.error(err)
        res.status(400).json({message: "couldn't add it"}).send()
    }

}

// Instantiates a client
exports.paymentDataHandler = async (pubsubMessage) => {

    const payload = Buffer.from(pubsubMessage.data, 'base64').toString()
    const data = JSON.parse(payload);

    const {id, amount, payer_email, type, status} = data.attributes

    if(!id || !payer_email){
        throw({error: "Message does not contain id or email"})
        // res.status(500).json({reason: "Message does not contain id or email"}).send()
    }

    // only if the event is `PAYMENT.CAPTURE.COMPLETED`, then do things in airtable
    if(type === 'PAYMENT.CAPTURE.COMPLETED'){

        // find existing records
        let resultRecords
        try{
            resultRecords = await findRecordInAirtable(`{Transaction ID} = '${id}'`, tablePaymentCompleted)
        }catch(err){
            console.error("Airtable select error", err)
            // res.status(500).json(err).send()
            throw({error: error})
        }
        
        // create the new record if it's not found
        if(!resultRecords.length){
            let createdRecords
            try{
                createdRecords = await createRecordInAirtable(data.attributes, tablePaymentCompleted)
            }catch(err){
                console.error("Airtable create error", err)
                // res.status(500).json(err).send()
                throw({error: error})
            }

            // send the message to pubsub after record created in airtable
            if(await publishPaymentApprovedMessage(createdRecords)){
                console.log("Message for payment-received sent")
                // res.status(200).send('OK')
            }else{
                // res.status(500).send('Failed to log message to pubsub after successfully crated record in airtable')
                throw({error: 'Failed to log message to pubsub after successfully crated record in airtable'})
            }
        }else{
            // found existing records, not creating
            // res.status(200).json({"reason": "Found existing record", data: [...resultRecords]}).send();
            console.log("Found existing record, OK.")
        }

    }else if( type === ''){
        // if it's failed payment

        // send notification emails
    }else{

        // res.status(200).json({ reason: "Unhandled event", ...data.attributes}).send();
        console.log("Unhandled event", data.attributes.type)
    }
    
  };