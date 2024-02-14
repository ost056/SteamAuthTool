const Account = require("./index");

Account.prototype.has_phone = async function(repeat = true){
    const result = await new Promise(res=>{
        this.steam_store.hasPhone((error, hasVerifiedPhone, lastDigits)=>{
            if (error) res({success: false, error: error.message});
            else res({success: true, has_phone: hasVerifiedPhone, last_digits: lastDigits});
        })
    })

    if (result.success || !repeat) return result
    else return await this.has_phone();
}

Account.prototype.add_phone_number = function(number){
    return new Promise(res=>{
        this.steam_store.addPhoneNumber(number, true, error=>{
            if (error) res({success: false, error: error.message})
            else {
                this.number = number;
                res({success: true})
            }
        })
    })
}

Account.prototype.send_sms = function(){
    return new Promise(res=>{
        this.steam_store.sendPhoneNumberVerificationMessage(error=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.resend_sms = function(){
    return new Promise(res=>{
        this.steam_store.resendVerificationSMS(error=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.confirm_phone = function(code){
    return new Promise(res=>{
        this.steam_store.verifyPhoneNumber(code, error=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.activate_2fa = function(){

    this.community.setMobileAppAccessToken(this.access_token);

    return new Promise(res=>{
        this.community.enableTwoFactor((error, twofa)=>{
            if (error) res({success: false, error: error.message})
            else {
                this.two_fa = {
                    ...twofa
                }
                res({success: true, r_code: twofa.revocation_code})
            }
        })
    })
}

Account.prototype.finalize_2fa = function (code){
    return new Promise(res=>{
        this.community.finalizeTwoFactor(this.two_fa.shared_secret, code, (error)=>{
            if (error) res({success: false, error: error.message})
            else res({success: true})
        })
    })
}

Account.prototype.moveTwoFactorStart = async function(){
    if (!this._weak_token) return {success: false, error: "Not Loggined"}


    const options = {
        apiInterface: "TwoFactor",
        apiMethod: "RemoveAuthenticatorViaChallengeStart",
        apiVersion: 1,
        accessToken: this._weak_token
    }

    try{
        await this.sessionRequest(options);
        return {success: true}
    }catch(error){
        return {success: false, error: error.message}
    }
}

Account.prototype.moveTwoFactorFinish = async function(sms_code = ""){
    if (!this._weak_token) return {success: false, error: "Not Loggined"}
    if (!sms_code) return {success: false, error: "SMS code is empty"}


    const options = {
        apiInterface: "TwoFactor",
        apiMethod: "RemoveAuthenticatorViaChallengeContinue",
        apiVersion: 1,
        accessToken: this._weak_token,
        data: {
            sms_code,
            generate_new_token: true
        }
    }

    try{
        const result = await this.sessionRequest(options);
        if (!result.success) return result
        this.two_fa = {
            ...result.replacement_token,
            shared_secret: Buffer.from(result.replacement_token.shared_secret).toString("base64"),
            identity_secret: Buffer.from(result.replacement_token.identity_secret).toString("base64"),
            secret_1: Buffer.from(result.replacement_token.secret_1).toString("base64"),
        }
        return {success: true, r_code: this.two_fa.revocation_code};
    }catch(error){
        return {success: false, error: error.message}
    }
}